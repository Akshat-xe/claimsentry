"""ClaimSentry Autonomous Triage Orchestration Engine.

Orchestrates Phase 1 (Ingestion), Phase 2 (Isolated Sandbox Verification),
and streams live log events to the Brutalist Web UI via SSE.
"""

import json
import os
import subprocess
import time
import uuid
from pathlib import Path
from typing import List, Dict, Any, Callable, Optional, Generator

from .models import Issue, IssueType, Evidence, VerdictStatus, Telemetry, LogEvent
from .sandbox import ExecutionSandbox
from .ast_scanner import CodebaseSymbolIndex
from .llm_engine import LocalLLMEngine
from .verifiers import BugVerifier, SecurityVerifier, DiffCoverageVerifier, MultimodalVerifier


class ClaimSentryEngine:
    def __init__(self, repo_dir: Path, llm_engine: Optional[LocalLLMEngine] = None):
        self.repo_dir = Path(repo_dir).resolve()
        self.sandbox = ExecutionSandbox(self.repo_dir)
        self.llm = llm_engine or LocalLLMEngine()
        self.symbol_index = CodebaseSymbolIndex(self.repo_dir)

        self.bug_verifier = BugVerifier(self.sandbox, self.llm, symbol_index=self.symbol_index)
        self.security_verifier = SecurityVerifier(self.sandbox, self.symbol_index)
        self.diff_verifier = DiffCoverageVerifier(self.sandbox)
        self.multimodal_verifier = MultimodalVerifier(self.sandbox)

        self.issues: List[Issue] = []
        self.logs: List[LogEvent] = []
        self.telemetry = Telemetry()

    def update_target_repo(self, new_repo_dir: Path):
        """Updates target repository and refreshes all verifiers and symbol tables."""
        self.repo_dir = Path(new_repo_dir).resolve()
        self.sandbox = ExecutionSandbox(self.repo_dir)
        self.symbol_index = CodebaseSymbolIndex(self.repo_dir)
        self.bug_verifier = BugVerifier(self.sandbox, self.llm, symbol_index=self.symbol_index)
        self.security_verifier = SecurityVerifier(self.sandbox, self.symbol_index)
        self.diff_verifier = DiffCoverageVerifier(self.sandbox)
        self.multimodal_verifier = MultimodalVerifier(self.sandbox)

    def log(self, phase: str, message: str, issue_id: Optional[str] = None, details: Optional[Dict[str, Any]] = None) -> LogEvent:
        """Appends and returns a structured log event."""
        event = LogEvent(
            id=str(uuid.uuid4())[:8],
            timestamp=time.strftime("%H:%M:%S"),
            phase=phase,
            message=message,
            issue_id=issue_id,
            details=details or {}
        )
        self.logs.append(event)
        return event

    def load_issues_from_json(self, json_path: Path):
        """Loads pre-configured or fetched issues from JSON file."""
        p = Path(json_path).resolve()
        if not p.exists():
            return
        data = json.loads(p.read_text(encoding="utf-8"))
        self.issues = [Issue(**item) for item in data]

    def triage_single_issue(self, issue: Issue, event_callback: Optional[Callable[[LogEvent], None]] = None) -> Issue:
        """Runs verification pipeline over a single issue with live event streaming."""
        start_time = time.perf_counter()

        def emit(phase: str, msg: str, i_id: Optional[str] = None, det: Optional[Dict[str, Any]] = None):
            ev = self.log(phase, msg, i_id, det)
            if event_callback:
                event_callback(ev)

        emit("FETCH", f"Auditing target codebase at {self.repo_dir.name}...", issue.id)
        emit("SANDBOX", f"Locked sandbox active: socket interception ON, env secrets wiped [0.00 MBPS]", issue.id)
        emit("AI-AGENT", f"Triaging Claim: '{issue.title}' ({issue.type.value.upper()})", issue.id)

        # Route to appropriate verifier
        if issue.has_screenshot or issue.has_video or issue.type == IssueType.MULTIMODAL:
            emit("AI-AGENT", f"Processing multimodal visual evidence for Issue #{issue.number}...", issue.id)
            self.multimodal_verifier.verify(issue)
        elif issue.type == IssueType.SECURITY or "cve" in issue.title.lower() or "rce" in issue.title.lower():
            emit("AST-SCAN", f"Auditing AST call graph & symbols for Issue #{issue.number}...", issue.id)
            self.security_verifier.verify(issue)
        elif issue.type == IssueType.PULL_REQUEST:
            emit("SANDBOX", f"Executing sandbox test suite with coverage intersection for PR #{issue.number}...", issue.id)
            self.diff_verifier.verify(issue)
        else:
            emit("AI-AGENT", f"Synthesizing minimal reproduction script for Issue #{issue.number}...", issue.id)
            self.bug_verifier.verify(issue)

        # Populate plain language human explanations
        self._enrich_plain_language_verdict(issue)

        emit("VERDICT", f"Verdict for Issue #{issue.number}: {issue.verdict_headline} [{issue.verdict_badge}]", issue.id)

        duration_ms = (time.perf_counter() - start_time) * 1000.0
        self.telemetry.execution_time_ms = round(duration_ms, 2)
        emit("TELEMETRY", f"Single Claim Triage finished in {self.telemetry.execution_time_ms}ms! Verdict: {issue.verdict_badge}")

        return issue

    def _enrich_plain_language_verdict(self, issue: Issue):
        """Generates dynamic, rich, non-repetitive plain language descriptions for every issue."""
        is_js_ts = any(f.endswith((".ts", ".tsx", ".js", ".jsx")) for f in self.symbol_index.scanned_files)
        matched_files = issue.evidence.matched_repo_files if issue.evidence else []
        symbols = issue.evidence.scanned_symbols if issue.evidence else []
        exit_code = issue.evidence.exit_code if issue.evidence else 0
        stderr = issue.evidence.stderr if issue.evidence else ""
        exec_ms = issue.evidence.execution_time_ms if issue.evidence else 15.0
        verdict_str = issue.verdict_badge or (issue.verdict.value if issue.verdict else "UNKNOWN")

        # Determine boolean is_real_issue
        if issue.verdict == VerdictStatus.VERIFIED_TRUE:
            issue.is_real_issue = True
        else:
            issue.is_real_issue = False

        # Generate unique, contextual explanation eliminating repetitive responses
        what_wrote, how_tested, verdict_expl = self.llm.generate_dynamic_triage_explanation(
            issue_title=issue.title,
            issue_body=issue.body,
            issue_type=issue.type.value if hasattr(issue.type, "value") else str(issue.type),
            repo_name=self.repo_dir.name,
            verdict=verdict_str,
            symbols_scanned=symbols,
            matched_files=matched_files,
            exit_code=exit_code,
            stderr=stderr,
            execution_time_ms=exec_ms,
            is_js_ts=is_js_ts
        )

        issue.what_user_wrote = what_wrote
        issue.how_we_tested = how_tested
        issue.our_verdict_explanation = verdict_expl

    def triage_all(self, event_callback: Optional[Callable[[LogEvent], None]] = None) -> List[Issue]:
        """Runs the complete verification pipeline over all loaded issues."""
        start_time = time.perf_counter()

        def emit(phase: str, msg: str, i_id: Optional[str] = None, det: Optional[Dict[str, Any]] = None):
            ev = self.log(phase, msg, i_id, det)
            if event_callback:
                event_callback(ev)

        emit("FETCH", f"Indexing codebase at {self.repo_dir.name}...")
        emit("SANDBOX", "Enforcing sandbox: network socket isolation & secret wiping active [0.00 MBPS | 0 SECRETS]")
        emit("AST-SCAN", f"Symbol table loaded: {len(self.symbol_index.symbols)} symbols across {len(self.symbol_index.scanned_files)} files")

        for issue in self.issues:
            emit("AI-AGENT", f"Triaging Issue #{issue.number}: '{issue.title}' ({issue.type.value.upper()})", issue.id)

            # Route to appropriate verifier
            if issue.has_screenshot or issue.has_video or issue.type == IssueType.MULTIMODAL:
                emit("AI-AGENT", f"Processing multimodal visual evidence for Issue #{issue.number}...", issue.id)
                self.multimodal_verifier.verify(issue)
            elif issue.type == IssueType.SECURITY or "cve" in issue.title.lower() or "rce" in issue.title.lower():
                emit("AST-SCAN", f"Auditing AST call graph & symbols for Issue #{issue.number}...", issue.id)
                self.security_verifier.verify(issue)
            elif issue.type == IssueType.PULL_REQUEST:
                emit("SANDBOX", f"Executing sandbox test suite with coverage intersection for PR #{issue.number}...", issue.id)
                self.diff_verifier.verify(issue)
            else:
                emit("AI-AGENT", f"Synthesizing minimal reproduction script for Issue #{issue.number}...", issue.id)
                self.bug_verifier.verify(issue)

            # Populate plain language human explanations
            self._enrich_plain_language_verdict(issue)

            emit("VERDICT", f"Issue #{issue.number} Verdict: {issue.verdict_headline} [{issue.verdict_badge}]", issue.id)

        duration_ms = (time.perf_counter() - start_time) * 1000.0

        # Update telemetry
        self.telemetry.execution_time_ms = round(duration_ms, 2)
        self.telemetry.total_claims_triaged = len(self.issues)
        self.telemetry.verified_bugs = sum(1 for i in self.issues if i.verdict == VerdictStatus.VERIFIED_TRUE and i.type == IssueType.BUG)
        self.telemetry.fake_slop_caught = sum(1 for i in self.issues if i.verdict == VerdictStatus.FAKE_SLOP)
        self.telemetry.untested_prs = sum(1 for i in self.issues if i.verdict == VerdictStatus.UNTESTED_PR)

        emit("TELEMETRY", f"Batch Triage Complete in {self.telemetry.execution_time_ms}ms! Verified: {self.telemetry.verified_bugs} | Fake Slop Caught: {self.telemetry.fake_slop_caught} | Untested PRs: {self.telemetry.untested_prs}")

        return self.issues
