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

// Create a new service
app.post("/services", verifyToken, async (req, res) => {
  const serviceData = req.body;

  const newService = {
    ...serviceData,
    vendorEmail: req.user.email,
    status: "pending",
    isActive: true,
    isFeatured: false,
    createdAt: new Date(),
  };

  const result = await services.insertOne(newService);
  res.send(result);
});

// Update own service vendor
app.patch("/services/:id", verifyToken, async (req, res) => {
  const id = req.params.id;

  const filter = {
    _id: new ObjectId(id),
    vendorEmail: req.user.email,
  };

  const updatedData = {
    $set: {
      ...req.body,
      updatedAt: new Date(),
    },
  };

  const result = await services.updateOne(filter, updatedData);
  res.send(result);
});

// Update service availability vendor
app.patch("/services/:id/availability", verifyToken, async (req, res) => {
  const id = req.params.id;
  const { isActive } = req.body;
  const filter = {
    _id: new ObjectId(id),
    vendorEmail: req.user.email,
  };
  const updatedDoc = {
    $set: {
      isActive: isActive,
      updatedAt: new Date(),
    },
  };
  const result = await services.updateOne(filter, updatedDoc);
  res.send(result);
});

// Delete own service vendor
app.delete("/services/:id", verifyToken, async (req, res) => {
  const id = req.params.id;

  const query = {
    _id: new ObjectId(id),
    vendorEmail: req.user.email,
  };

  const result = await services.deleteOne(query);
  res.send(result);
});

// Create booking request
app.post("/bookings", verifyToken, async (req, res) => {
  const bookingData = req.body;

  const newBooking = {
    ...bookingData,
    customerEmail: req.user.email,
    status: "pending",
    createdAt: new Date(),
  };

  const result = await bookings.insertOne(newBooking);
  res.send(result);
});

// Get own bookings
app.get("/bookings/my-bookings", verifyToken, async (req, res) => {
  const query = {
    customerEmail: req.user.email,
  };

  const result = await bookings.find(query).toArray();
  res.send(result);
});

// Get booking details
app.get("/bookings/:id", verifyToken, async (req, res) => {
  const id = req.params.id;

  const query = {
    _id: new ObjectId(id),
  };

  const result = await bookings.findOne(query);

  if (!result) {
    return res.status(404).send({ message: "Booking not found" });
  }

  if (
    result.customerEmail !== req.user.email &&
    result.vendorEmail !== req.user.email
  ) {
    return res.status(403).send({ message: "Access denied" });
  }

  res.send(result);
});


// Cancel pending bookby customer
app.patch("/bookings/:id/cancel", verifyToken, async (req, res) => {
  const id = req.params.id;

  const query = {
    _id: new ObjectId(id),
    customerEmail: req.user.email,
    status: "pending",
  };

  const updatedDoc = {
    $set: {
      status: "cancelled",
      updatedAt: new Date(),
    },
  };

  const result = await bookings.updateOne(query, updatedDoc);
  res.send(result);
});

// Get bookings for own services vendor
app.get("/vendor/bookings", verifyToken, async (req, res) => {
  const query = {
    vendorEmail: req.user.email,
  };

  const result = await bookings.find(query).toArray();
  res.send(result);
});


// Accept or reject booby vendor
app.patch("/vendor/bookings/:id/status", verifyToken, async (req, res) => {
  const id = req.params.id;
  const { status } = req.body;

  if (!["accepted", "rejected"].includes(status)) {
    return res.status(400).send({
      message: "Invalid booking status",
    });
  }

  const query = {
    _id: new ObjectId(id),
    vendorEmail: req.user.email,
    status: "pending",
  };

  const updatedDoc = {
    $set: {
      status: status,
      updatedAt: new Date(),
    },
  };

  const result = await bookings.updateOne(query, updatedDoc);
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
