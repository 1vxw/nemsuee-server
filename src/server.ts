import "dotenv/config";
import { app } from "./app.js";
import { initDb } from "./bootstrap.js";

const port = Number(process.env.PORT || 5000);

initDb()
  .then(() => {
    app.listen(port, () => {
      console.log(`API listening on http://localhost:${port}`);
    });
  })
  .catch((err) => {
    console.error("Database initialization failed", err);
    process.exit(1);
  });
