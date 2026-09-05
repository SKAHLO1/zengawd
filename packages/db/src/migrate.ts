import { getDb, resolveDatabasePath } from "./index";

getDb();
console.log(`migrations applied to ${resolveDatabasePath()}`);
