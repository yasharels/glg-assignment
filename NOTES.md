1. Trying to get the app running using the initial state of the repo surfaced a `QueueDoesNotExist` error.
   The docker compose definition for the elasticmq service (`SQS`) set the `command` to 
   `-Dconfig.file=/etc/elasticmq/elasticmq.conf`. `softwaremill/elasticmq` sets its `ENTRYPOINT` 
   to `["java" "-Dconfig.file=/opt/elasticmq.conf" "-jar" "/opt/elasticmq/elasticmq-server.jar"]`. 
   So what was actually happening was the compose file's `command` was being appended to that 
   `ENTRYPOINT`, becoming interpreted as application-level arguments that just got ignored.
   My solution was to simply change the config filename inside the container to what the
   default expects - i.e., `/opt/elasticmq.conf`.
   