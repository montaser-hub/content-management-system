# Permission matrix — approved

Status: **approved**, amended from the original section-5 matrix to cover the self-registration flow. This is now the source of truth `RolesGuard` decorators are written against — if a route's access isn't a row here, it isn't in scope yet.

## Matrix

| Action | Public (no account) | Admin | Editor | Contributor | Viewer |
|---|---|---|---|---|---|
| Submit registration request | **Yes** | — | — | — | — |
| Log in | — | Yes | Yes | Yes | Yes |
| View published articles | — | Yes | Yes | Yes | Yes |
| View all drafts | — | Yes | Yes | No | No |
| View own drafts | — | Yes | Yes | Yes | No |
| Create article drafts | — | Yes | Yes | Yes | No |
| Edit any article | — | Yes | Yes | No | No |
| Edit own draft | — | Yes | Yes | Yes | No |
| Publish or unpublish articles | — | Yes | Yes | No | No |
| Delete any article | — | Yes | Yes | No | No |
| Delete own unpublished draft | — | Yes | Yes | Yes | No |
| Upload media | — | Yes | Yes | Yes | No |
| Manage all media | — | Yes | Yes | No | No |
| **Approve / reject registrations, manage users and roles** | — | **Yes** | No | No | No |

The bolded row is the one this amendment adds explicitly: **"Submit registration request"** is a new, public, no-account-required action that the original matrix didn't enumerate — the earlier version implicitly assumed accounts already existed, starting at "Log in." Everything else is carried over unchanged from the original.

## What changed and why

The original flow had the Admin creating every account directly, so there was no public entry point to grade. Moving to self-registration + admin approval introduces exactly one new access boundary: **anyone, with no account, can submit a request.** That's the row that needed adding — nothing else in the matrix moves, because approval/role-assignment was already covered by "Manage users and roles," which now explicitly folds in approve/reject.

## Enforcement rule (unchanged)

The expected response for an unauthorized API operation is a proper **403 Forbidden** with a JSON body, not merely a hidden button in the interface. This applies identically whether the caller has the wrong role or no role at all (a still-pending or rejected account) — see [story-1-admin-creates-users.md](story-1-admin-creates-users.md) §6.
