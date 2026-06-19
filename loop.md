If the time is greater than 13:30 (using my computer's time), stop looping.

Read ./docs/migration/ fully. It contains documents about migrating a python codebase to typescript, and also progress reports done by other agents.

Reason about the next migration item to pick up and use the reference python code at ./reference/prov/ to drive the typescript implementation.

The migration item should be tested. The reference python impl has comprehensive tests.

After the migration item is implemented, write a doc in ./docs/migration/ where you document the progress for the next agent to pick it up.

You may not install anything on the system, besides npm packages that may be required by the implementation (however, even those should have appeared in the migration docs).

Do your best!
