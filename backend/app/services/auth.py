from __future__ import annotations

from dataclasses import dataclass

from fastapi import Header, HTTPException, Query


ADMIN_ROLES = {"admin", "operator"}
PARTNER_ROLES = {"business_manager", "expert"}
PARTNER_WORKSPACE_SCOPES = {"business_operations", "expert_personal"}


@dataclass(frozen=True)
class AdminPrincipal:
  account_id: str
  role: str


@dataclass(frozen=True)
class PartnerPrincipal:
  account_id: str
  role: str
  business_id: str
  expert_id: str | None
  workspace_scope: str


def validate_admin_principal(principal: AdminPrincipal) -> AdminPrincipal:
  account_id = _clean(principal.account_id)
  role = _normalize(principal.role)

  if not account_id:
    raise HTTPException(status_code=401, detail="Admin account is required.")
  if role not in ADMIN_ROLES:
    raise HTTPException(status_code=403, detail="Admin role is required.")

  return AdminPrincipal(account_id=account_id, role=role)


def validate_partner_principal(principal: PartnerPrincipal) -> PartnerPrincipal:
  account_id = _clean(principal.account_id)
  role = _normalize(principal.role)
  business_id = _clean(principal.business_id)
  expert_id = _clean(principal.expert_id) or None
  workspace_scope = _normalize(principal.workspace_scope)

  if not account_id:
    raise HTTPException(status_code=401, detail="Partner account is required.")
  if role not in PARTNER_ROLES:
    raise HTTPException(status_code=403, detail="Partner role is required.")
  if not business_id or business_id == "platform":
    raise HTTPException(status_code=403, detail="Partner business scope is required.")
  if workspace_scope not in PARTNER_WORKSPACE_SCOPES:
    raise HTTPException(status_code=403, detail="Valid partner workspace scope is required.")
  if role == "expert" and workspace_scope != "expert_personal":
    raise HTTPException(status_code=403, detail="Expert accounts must use expert_personal scope.")
  if role == "business_manager" and workspace_scope == "expert_personal":
    raise HTTPException(status_code=403, detail="Business managers must use business_operations scope.")
  if workspace_scope == "expert_personal" and not expert_id:
    raise HTTPException(status_code=403, detail="Expert personal scope requires expert_id.")

  return PartnerPrincipal(
    account_id=account_id,
    role=role,
    business_id=business_id,
    expert_id=expert_id,
    workspace_scope=workspace_scope,
  )


async def get_admin_principal(
  x_admin_id: str | None = Header(default=None, alias="X-Admin-Id"),
  x_aura_role: str | None = Header(default=None, alias="X-Aura-Role"),
  x_admin_role: str | None = Header(default=None, alias="X-Admin-Role"),
) -> AdminPrincipal:
  role = x_aura_role or x_admin_role
  return validate_admin_principal(AdminPrincipal(account_id=x_admin_id or "", role=role or ""))


async def get_partner_principal(
  x_partner_account_id: str | None = Header(default=None, alias="X-Partner-Account-Id"),
  x_partner_role: str | None = Header(default=None, alias="X-Partner-Role"),
  x_business_id: str | None = Header(default=None, alias="X-Business-Id"),
  x_expert_id: str | None = Header(default=None, alias="X-Expert-Id"),
  x_workspace_scope: str | None = Header(default=None, alias="X-Workspace-Scope"),
  account_id: str | None = Query(default=None, alias="accountId"),
  role: str | None = Query(default=None),
  business_id: str | None = Query(default=None, alias="businessId"),
  expert_id: str | None = Query(default=None, alias="expertId"),
  workspace_scope: str | None = Query(default=None, alias="workspaceScope"),
) -> PartnerPrincipal:
  return validate_partner_principal(
    PartnerPrincipal(
      account_id=x_partner_account_id or account_id or "",
      role=x_partner_role or role or "",
      business_id=x_business_id or business_id or "",
      expert_id=x_expert_id or expert_id,
      workspace_scope=x_workspace_scope or workspace_scope or "",
    )
  )


def _clean(value: str | None) -> str:
  return (value or "").strip()


def _normalize(value: str | None) -> str:
  return _clean(value).lower()
