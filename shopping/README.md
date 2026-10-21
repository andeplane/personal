# Shopping and owned inventory

`items.json` drives the public shopping page. Preserve item IDs: existing browser checkboxes refer to them.

`inventory.json` is the durable purchase inventory. It records each confirmed order, project, purpose, quantity, and paid amount. The four local orders were confirmed collected by the user on 21 October 2026; all their items are owned. Proshop and Polyalkemi are paid orders awaiting confirmation of receipt. Do not infer receipt from payment or an order confirmation.

Confirmed ownership is stored in the files, not only localStorage. Resetting browser checkboxes does not make owned items into shopping suggestions again. Planned online lamp purchases remain separate and are not inventory.

Keep contact details, delivery addresses, payment credentials, and raw receipts out of these public files. Update purchase/receipt status only from merchant evidence or the user's confirmation.
