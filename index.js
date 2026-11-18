import express from "express";
import "dotenv/config";

const port = process.env.PORT;
const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send({ message: "Weading plan server runnig" });
});

app.listen(port, () => {
  console.log(`Weading plan app listening on port ${port}`);
});
