# Inventory

## Manage stock

1. Create categories, then add items with a clear unit and opening quantity if the form supports it.
2. Record every receipt, issue, return, or adjustment as a transaction; select the right item and quantity and add a reason/reference.
3. Check the updated stock balance and transaction history after saving. Avoid editing stock totals directly when a transaction is the proper record.

## Requisitions

1. Submit a requisition with requested items, quantities, and business reason.
2. Approvers review each workflow step and approve/reject with any required note.
3. Authorized staff fulfill an approved request by recording the stock transaction; confirm fulfillment and resulting balances.


## Setup, updates, and verification

### Set up stock and control changes

Create categories and item records with consistent units before entering transactions. Record opening stock and every receipt, issue, return, or adjustment through the transaction flow with quantity and reference/reason. For requisitions, verify the request, approval state, and fulfillment separately; only record fulfillment when stock actually moves. After each transaction, compare the item balance with its history. Resolve discrepancies with an authorized adjustment instead of editing a balance directly.

**Access:** Inventory permissions separate read, manage, transact, requisition, and workflow configuration. Teachers may have request-only access; plan and module gates also apply.

**Sources:** `client/src/pages/inventory/`; `server/routes/inventory.js`; workflow configuration in `server/utils/workflow-config.js`.; [CHANGELOG.md](../../CHANGELOG.md)
