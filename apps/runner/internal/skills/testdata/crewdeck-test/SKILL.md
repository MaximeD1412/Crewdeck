---
name: crewdeck-test
description: The Skill of the Runner's tests. Reads its Ticket through the Miroir and reports its figures. Never mounted outside the tests.
---

# The test Skill

1. Start the StepRun, and read its context:

   ```sh
   crewdeck-runner etape start
   ```

2. Read the Ticket of the Entrée `ticket`, its number `<n>`, through the
   Miroir:

   ```sh
   mirror issue view <n> --json title,body,labels
   ```

3. Report:

   ```sh
   echo '{"figures":{"read":1},"content":"Le Ticket est lu."}' | crewdeck-runner etape report --file -
   ```
