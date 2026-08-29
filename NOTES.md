1. Trying to get the app running using the initial state of the repo surfaced a `QueueDoesNotExist` error.
   The docker compose definition for the elasticmq service (`SQS`) set the `command` to 
   `-Dconfig.file=/etc/elasticmq/elasticmq.conf`. `softwaremill/elasticmq` sets its `ENTRYPOINT` 
   to `["java" "-Dconfig.file=/opt/elasticmq.conf" "-jar" "/opt/elasticmq/elasticmq-server.jar"]`. 
   So what was actually happening was the compose file's `command` was being appended to that 
   `ENTRYPOINT`, becoming interpreted as application-level arguments that just got ignored.
   My solution was to simply change the config filename inside the container to what the
   default expects - i.e., `/opt/elasticmq.conf`.

2. The PDF receipt's "Total Amount" was inconsistent with the prices and quantities
   for the items it listed. Previously, it came from `amount`, which is supplied by the client
   in the API request. The actual items, of course, are server-side randomly generated fake data.
   Task 3 asked to fix the PDF render, which could be done straightforwardly by summing up
   `item.price * item.quantity` over the order's items. Also renamed "Price" to "Unit Price"
   in the PDF to be less ambiguous.

   Caveat:
   - This fixes the PDF render, but leaves the data in Dynamo inconsistent with the client's
   `amount`, as well as what we get from `GET /api/orders`. If I were to do this properly,
   in a production scenario, I would probably just not have the client send `amount` at all.
   Instead, it'd include the items it wants in the order, and the intake worker would 
   enrich the order data with the prices from our backend, including the total. The PDF
   renderer would just directly use that data. I chose not to go with that more involved
   approach since as noted above, this project generates random items data, and 
   doesn't actually have price data to look up.