import express from "express";
import "dotenv/config";
import { MongoClient, ObjectId } from "mongodb";

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

const mongoClient = await connectToMongoDB();
const db = mongoClient.db("weding-plan");
const services = db.collection("services");

app.use(express.json());

app.get("/", (req, res) => {
  res.send({ message: "Weading plan server runnig" });
});


// Get all submitted services
app.get("/services", async (req, res) => {
  const result = await services.find().toArray();
  res.send(result);
});

// Get service details
app.get("/services/:id", async (req, res) => {
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };
  const result = await services.findOne(query);
  res.send(result);
});
// Get featured services
app.get("/services/featured", async (req, res) => {
  const query = {
    status: "approved",
    isActive: true,
    isFeatured: true,
  };

  const result = await services.find(query).toArray();
  res.send(result);
});

// Get all service categories
app.get("/services/categories", async (req, res) => {
  const result = await services.distinct("category", {
    status: "approved",
    isActive: true,
  });

  res.send(result);
});

// app.get("/vendor/services", async (req, res) => {
//   const result = await services.find().toArray();
//   res.send(result);
// });

// app.post("/services", async (req, res) => {
//   const data = req.body;
//   const result = await services.insertOne(data);
//   res.send(result);
// });

// app.patch("/services/:id", async (req, res) => {
//   const id = req.params.id;
//   const query = { _id: new ObjectId(id) };
//   const result = await services.updateOne(query);
//   res.send(result);
// });

// app.delete("/services/:id", async (req, res) => {
//   const id = req.params.id;
//   const query = { _id: new ObjectId(id) };
//   const result = await services.deleteOne(query);
//   res.send(result);
// });

app.listen(port, () => {
  console.log(`Weading plan app listening on port ${port}`);
});
