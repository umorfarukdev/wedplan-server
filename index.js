import express from "express";
import "dotenv/config";
import { MongoClient } from "mongodb";

const port = process.env.PORT;
const app = express();
const client = new MongoClient(process.env.MONGO_DB_URI);
export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

connectToMongoDB()

app.use(express.json());

app.get("/", (req, res) => {
  res.send({ message: "Weading plan server runnig" });
});

app.listen(port, () => {
  console.log(`Weading plan app listening on port ${port}`);
});
