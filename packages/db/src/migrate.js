import { getDb, resolveDatabasePath } from "./index";
getDb();
console.log(`migrations applied to ${resolveDatabasePath()}`);
//# sourceMappingURL=migrate.js.map