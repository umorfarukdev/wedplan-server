import express from "express";
import "dotenv/config";
import { MongoClient, ObjectId } from "mongodb";
import cors from "cors";

const port = process.env.PORT;
const app = express();
app.use(cors());
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
const bookings = db.collection("bookings");
const users = db.collection("user");

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
app.get("/service/:id", async (req, res) => {
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
app.post("/services", async (req, res) => {
  const {
      serviceName,
      category,
      description,
      price,
      location,
      images,
    } = req.body;

  const newService = {
      serviceName,
      category,
      description,
      price: Number(price),
      location,
      images,
      vendorId: req.user.id,
      status: "pending",
      createdAt: new Date(),
    };

  const result = await services.insertOne(newService);
  res.send(result);
});

// Update own service vendor
app.patch("/services/:id", async (req, res) => {
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
app.patch("/services/:id/availability", async (req, res) => {
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
app.delete("/services/:id", async (req, res) => {
  const id = req.params.id;

  const query = {
    _id: new ObjectId(id),
    vendorEmail: req.user.email,
  };

  const result = await services.deleteOne(query);
  res.send(result);
});

// Create booking request
app.post("/bookings", async (req, res) => {
  const {
      serviceId,
      vendorId,
      customerId,
      eventDate,
      eventLocation,
      message,
    } = req.body;

      const booking = {
      serviceId,
      vendorId,
      customerId,
      eventDate,
      eventLocation,
      message: message || "",
      status: "pending",
      createdAt: new Date(),
    };

  const result = await bookings.insertOne(booking);
  res.send(result);
});

// Get own bookings
app.get("/my-bookings/:email", async (req, res) => {
  const query = {
    customerEmail: req.params.email,
  };

  const result = await bookings.find(query).toArray();
  res.send(result);
});

// Get booking details
app.get("/bookings/:id", async (req, res) => {
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
app.patch("/bookings/:id/cancel", async (req, res) => {
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
app.get("/vendor/bookings", async (req, res) => {
  const query = {
    vendorEmail: req.user.email,
  };

  const result = await bookings.find(query).toArray();
  res.send(result);
});


// Accept or reject booby vendor
app.patch("/vendor/bookings/:id/status", async (req, res) => {
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

// Get vendor dashboard overview
app.get("/vendor/dashboard", async (req, res) => {
  const email = req.user.email;

  const totalServices = await services.countDocuments({
    vendorEmail: email,
  });

  const totalBookings = await bookings.countDocuments({
    vendorEmail: email,
  });

  const pendingBookings = await bookings.countDocuments({
    vendorEmail: email,
    status: "pending",
  });

  const acceptedBookings = await bookings.countDocuments({
    vendorEmail: email,
    status: "accepted",
  });

  const rejectedBookings = await bookings.countDocuments({
    vendorEmail: email,
    status: "rejected",
  });

  const cancelledBookings = await bookings.countDocuments({
    vendorEmail: email,
    status: "cancelled",
  });

  const result = {
    totalServices,
    totalBookings,
    pendingBookings,
    acceptedBookings,
    rejectedBookings,
    cancelledBookings,
  };

  res.send(result);
});


// Get customer dashboard overview
app.get("/customer/dashboard", async (req, res) => {
  const email = req.user.email;

  const totalBookings = await bookings.countDocuments({
    customerEmail: email,
  });

  const pendingBookings = await bookings.countDocuments({
    customerEmail: email,
    status: "pending",
  });

  const acceptedBookings = await bookings.countDocuments({
    customerEmail: email,
    status: "accepted",
  });

  const rejectedBookings = await bookings.countDocuments({
    customerEmail: email,
    status: "rejected",
  });

  const cancelledBookings = await bookings.countDocuments({
    customerEmail: email,
    status: "cancelled",
  });

  const result = {
    totalBookings,
    pendingBookings,
    acceptedBookings,
    rejectedBookings,
    cancelledBookings,
  };

  res.send(result);
});

// Get customer booking statistics
app.get("/customer/statistics", async (req, res) => {
  const email = req.user.email;

  const result = await bookings.aggregate([
    {
      $match: {
        customerEmail: email,
      },
    },
    {
      $group: {
        _id: null,

        totalBookings: {
          $sum: 1,
        },

        pendingBookings: {
          $sum: {
            $cond: [{ $eq: ["$status", "pending"] }, 1, 0],
          },
        },

        acceptedBookings: {
          $sum: {
            $cond: [{ $eq: ["$status", "accepted"] }, 1, 0],
          },
        },

        rejectedBookings: {
          $sum: {
            $cond: [{ $eq: ["$status", "rejected"] }, 1, 0],
          },
        },

        cancelledBookings: {
          $sum: {
            $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0],
          },
        },
      },
    },
  ]).toArray();

  res.send(
    result[0] || {
      totalBookings: 0,
      pendingBookings: 0,
      acceptedBookings: 0,
      rejectedBookings: 0,
      cancelledBookings: 0,
    }
  );
});

// Get customer bookings
app.get("/customer/bookings", async (req, res) => {
  const query = {
    customerEmail: req.user.email,
  };

  const result = await bookings.find(query).sort({
    createdAt: -1,
  }).toArray();

  res.send(result);
});


// Get admin dashboard overview
app.get("/admin/dashboard", async (req, res) => {
  const totalUsers = await users.countDocuments();

  const totalVendors = await users.countDocuments({
    role: "vendor",
  });

  const totalCustomers = await users.countDocuments({
    role: "customer",
  });

  const totalServices = await services.countDocuments();

  const pendingServices = await services.countDocuments({
    status: "pending",
  });

  const totalBookings = await bookings.countDocuments();

  const totalTransactions = await payments.countDocuments();

  const result = {
    totalUsers,
    totalVendors,
    totalCustomers,
    totalServices,
    pendingServices,
    totalBookings,
    totalTransactions,
  };

  res.send(result);
});

// Get all users
app.get("/admin/users", async (req, res) => {
  const result = await users.find().toArray();

  res.send(result);
});


// Get user details
app.get("/admin/users/:id", async (req, res) => {
  const id = req.params.id;

  const query = {
    _id: new ObjectId(id),
  };

  const result = await users.findOne(query);

  if (!result) {
    return res.status(404).send({
      message: "User not found",
    });
  }

  res.send(result);
});

// Block user
app.patch("/admin/users/:id/block", async (req, res) => {
  const id = req.params.id;

  const query = {
    _id: new ObjectId(id),
    role: { $ne: "admin" },
  };

  const updatedDoc = {
    $set: {
      isBlocked: true,
      updatedAt: new Date(),
    },
  };

  const result = await users.updateOne(query, updatedDoc);

  res.send(result);
});

// Unblock user
app.patch("/admin/users/:id/unblock", async (req, res) => {
  const id = req.params.id;

  const query = {
    _id: new ObjectId(id),
    role: { $ne: "admin" },
  };

  const updatedDoc = {
    $set: {
      isBlocked: false,
      updatedAt: new Date(),
    },
  };

  const result = await users.updateOne(query, updatedDoc);

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
