"""
elisra-mcp-ado — Open WebUI native Python tool
------------------------------------------------
Wraps the mcpo HTTP bridge so each user supplies their own ADO PAT
via UserValves (set once in the chat UI — never re-entered).

Admin sets Valves (mcpo URL + API key) once at tool-install time.
Users set UserValves (their ADO PAT) from the chat UI.

Install:
  Open WebUI → Workspace → Tools → + → paste this file → Save
"""

import json
import urllib.request
import urllib.error
from typing import Any, Optional
from pydantic import BaseModel, Field


class Valves(BaseModel):
    mcpo_url: str = Field(
        default="http://docgen-mcp-ado.docgen.svc.cluster.local",
        description="mcpo service base URL (no trailing slash)",
    )
    mcpo_api_key: str = Field(
        default="",
        description="MCPO_API_KEY — the bearer token that guards the mcpo endpoint",
    )


class UserValves(BaseModel):
    ado_pat: str = Field(
        default="",
        description="Your Azure DevOps Personal Access Token (stored per-user, never shared)",
    )


class Tools:
    def __init__(self):
        self.valves = Valves()

    # ------------------------------------------------------------------ #
    # Internal helper                                                       #
    # ------------------------------------------------------------------ #

    def _call(self, tool: str, args: dict, user_valves: UserValves) -> str:
        if user_valves.ado_pat:
            args["auth"] = {"pat": user_valves.ado_pat}

        url = f"{self.valves.mcpo_url}/{tool}"
        data = json.dumps(args).encode()
        req = urllib.request.Request(
            url,
            data=data,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.valves.mcpo_api_key}",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.read().decode()
        except urllib.error.HTTPError as e:
            body = e.read().decode()
            return json.dumps({"error": e.code, "detail": body})
        except Exception as e:
            return json.dumps({"error": str(e)})

    # ------------------------------------------------------------------ #
    # Health                                                                #
    # ------------------------------------------------------------------ #

    def ado_ping(self, __user__: dict = {}) -> str:
        """
        Ping Azure DevOps Server and return top 10 projects + API version.
        Use this to verify connectivity and that the PAT is working.
        """
        uv = UserValves(**(__user__ or {}).get("valves") or {})
        return self._call("ado_ping", {}, uv)

    def ado_check_pat(self, __user__: dict = {}) -> str:
        """
        Verify that the ADO Personal Access Token stored in UserValves is valid.
        Returns the display name of the token owner on success.
        """
        uv = UserValves(**(__user__ or {}).get("valves") or {})
        return self._call("ado_check_pat", {}, uv)

    # ------------------------------------------------------------------ #
    # Scope & query                                                         #
    # ------------------------------------------------------------------ #

    def ado_query_work_item_ids(
        self,
        project: str,
        wiql: str,
        top: int = 200,
        __user__: dict = {},
    ) -> str:
        """
        Execute a WIQL query and return matching work item IDs.

        Args:
            project: Azure DevOps project name.
            wiql: Full WIQL SELECT statement.
            top: Maximum number of IDs to return (default 200).
        """
        uv = UserValves(**(__user__ or {}).get("valves") or {})
        return self._call("ado_query_work_item_ids", {"project": project, "wiql": wiql, "top": top}, uv)

    def ado_resolve_review_scope(
        self,
        source: dict,
        project: Optional[str] = None,
        response_mode: str = "overview",
        cursor: Optional[str] = None,
        page_size: int = 50,
        __user__: dict = {},
    ) -> str:
        """
        Resolve a review scope (WIQL, IDs, field filters, or linked items) to a list of work item IDs.

        Args:
            source: Scope source. Examples:
                {"type": "wiql", "wiql": "SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType] = 'Requirement'"}
                {"type": "ids", "ids": [1, 2, 3]}
                {"type": "fieldFilters", "filters": [{"field": "System.WorkItemType", "operator": "=", "value": "Requirement"}]}
                {"type": "linkedItems", "rootId": 42, "depth": 2}
            project: Project name (required for wiql and fieldFilters sources).
            response_mode: "overview" (counts + preview only) | "ids" (paginated ID list).
            cursor: Pagination cursor from a previous call's pageInfo.nextCursor. Omit for first page.
            page_size: IDs per page in "ids" mode (default 50, max 200).
        """
        uv = UserValves(**(__user__ or {}).get("valves") or {})
        args: dict[str, Any] = {"source": source, "responseMode": response_mode, "pageSize": page_size}
        if project:
            args["project"] = project
        if cursor:
            args["cursor"] = cursor
        return self._call("ado_resolve_review_scope", args, uv)

    # ------------------------------------------------------------------ #
    # Work items                                                            #
    # ------------------------------------------------------------------ #

    def ado_get_work_items_by_ids(
        self,
        ids: list,
        fields: Optional[list] = None,
        expand: str = "none",
        __user__: dict = {},
    ) -> str:
        """
        Fetch work items by ID list.

        Args:
            ids: List of work item IDs (max 200 per call).
            fields: Optional list of field reference names to include.
            expand: "none" | "relations" | "all"
        """
        uv = UserValves(**(__user__ or {}).get("valves") or {})
        args: dict[str, Any] = {"ids": ids, "expand": expand}
        if fields:
            args["fields"] = fields
        return self._call("ado_get_work_items_by_ids", args, uv)

    def ado_get_review_scope_overview(
        self,
        source: dict,
        group_by: Optional[list] = None,
        project: Optional[str] = None,
        __user__: dict = {},
    ) -> str:
        """
        Get a grouped overview of work items matching a scope — counts and sample IDs per group.

        Args:
            source: Same as ado_resolve_review_scope.
            group_by: List of field ref names to group by, e.g. ["System.WorkItemType", "System.State"]
            project: Project name.
        """
        uv = UserValves(**(__user__ or {}).get("valves") or {})
        args: dict[str, Any] = {"source": source}
        if group_by:
            args["groupBy"] = group_by
        if project:
            args["project"] = project
        return self._call("ado_get_review_scope_overview", args, uv)

    # ------------------------------------------------------------------ #
    # Field discovery                                                       #
    # ------------------------------------------------------------------ #

    def ado_discover_fields(
        self,
        project: Optional[str] = None,
        work_item_type: Optional[str] = None,
        refresh: bool = False,
        __user__: dict = {},
    ) -> str:
        """
        Discover available work item fields including custom fields.
        Results are cached for 1 hour. Use refresh=True to invalidate.

        Args:
            project: Optional project name to filter fields.
            work_item_type: Optional work item type name to filter, e.g. "Requirement".
            refresh: Set True to force re-fetch from ADO.
        """
        uv = UserValves(**(__user__ or {}).get("valves") or {})
        args: dict[str, Any] = {"refresh": refresh}
        if project:
            args["project"] = project
        if work_item_type:
            args["workItemType"] = work_item_type
        return self._call("ado_discover_fields", args, uv)

    # ------------------------------------------------------------------ #
    # Review                                                                #
    # ------------------------------------------------------------------ #

    def ado_review_requirements(
        self,
        source: dict,
        project: Optional[str] = None,
        context_mode: str = "none",
        context_field: Optional[str] = None,
        __user__: dict = {},
    ) -> str:
        """
        Review requirements for quality: clarity, completeness, consistency, singularity,
        verifiability, feasibility, and traceability. Returns per-item findings with confidence.

        Args:
            source: Scope source (see ado_resolve_review_scope).
            project: Project name.
            context_mode: "none" | "linked" | "siblings" | "sameField"
            context_field: Field ref name for sameField context, e.g. "Custom.SubSystem"
        """
        uv = UserValves(**(__user__ or {}).get("valves") or {})
        args: dict[str, Any] = {"source": source, "contextMode": context_mode}
        if project:
            args["project"] = project
        if context_field:
            args["contextField"] = context_field
        return self._call("ado_review_requirements", args, uv)

    def ado_find_requirement_completeness_gaps(
        self,
        source: dict,
        context_mode: str = "linked",
        context_field: Optional[str] = None,
        project: Optional[str] = None,
        __user__: dict = {},
    ) -> str:
        """
        Find requirements with completeness gaps: missing descriptions, acceptance criteria,
        verification methods, or traceability links.

        Args:
            source: Scope source.
            context_mode: "none" | "linked" | "siblings" | "sameField"
            context_field: Field for sameField comparison.
            project: Project name.
        """
        uv = UserValves(**(__user__ or {}).get("valves") or {})
        args: dict[str, Any] = {"source": source, "contextMode": context_mode}
        if project:
            args["project"] = project
        if context_field:
            args["contextField"] = context_field
        return self._call("ado_find_requirement_completeness_gaps", args, uv)

    def ado_find_requirement_consistency_candidates(
        self,
        source: dict,
        comparison_mode: str = "parent",
        comparison_field: Optional[str] = None,
        max_group_size: int = 25,
        project: Optional[str] = None,
        __user__: dict = {},
    ) -> str:
        """
        Find pairs of requirements that may be inconsistent: conflicting thresholds,
        near-duplicate titles, or contradictory shall/shall-not patterns.

        Args:
            source: Scope source.
            comparison_mode: "parent" | "field" | "title"
            comparison_field: Field ref name when comparison_mode="field".
            max_group_size: Groups larger than this are truncated (default 25, max to avoid O(N²)).
            project: Project name.
        """
        uv = UserValves(**(__user__ or {}).get("valves") or {})
        args: dict[str, Any] = {
            "source": source,
            "comparisonMode": comparison_mode,
            "maxGroupSize": max_group_size,
        }
        if project:
            args["project"] = project
        if comparison_field:
            args["comparisonField"] = comparison_field
        return self._call("ado_find_requirement_consistency_candidates", args, uv)

    # ------------------------------------------------------------------ #
    # Context packets                                                       #
    # ------------------------------------------------------------------ #

    def ado_build_requirement_context_packet(
        self,
        id: int,
        include_parents: bool = True,
        include_children: bool = True,
        include_linked: bool = True,
        include_siblings: bool = False,
        context_field: Optional[str] = None,
        project: Optional[str] = None,
        __user__: dict = {},
    ) -> str:
        """
        Build a bounded context packet for a requirement: parents, children, coverage links,
        tests, related items, and optionally siblings or same-field items.

        Args:
            id: Work item ID.
            include_parents: Include parent hierarchy (up to 3 levels).
            include_children: Include child items (up to 100).
            include_linked: Include covers/covered-by/test links.
            include_siblings: Include sibling items (same parent).
            context_field: Field ref name to include same-field items, e.g. "Custom.SubSystem"
            project: Project name.
        """
        uv = UserValves(**(__user__ or {}).get("valves") or {})
        context_options: dict[str, Any] = {
            "includeParents": include_parents,
            "includeChildren": include_children,
            "includeLinked": include_linked,
            "includeSiblings": include_siblings,
        }
        if context_field:
            context_options["contextField"] = context_field
        args: dict[str, Any] = {"id": id, "contextOptions": context_options}
        if project:
            args["project"] = project
        return self._call("ado_build_requirement_context_packet", args, uv)
