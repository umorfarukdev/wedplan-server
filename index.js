import express from "express";
import "dotenv/config";
import { MongoClient, ObjectId } from "mongodb";
import cors from "cors";
import Stripe from "stripe";

const port = process.env.PORT;
const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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
console.log("Database Name:", db.databaseName);
const services = db.collection("services");
const bookings = db.collection("bookings");
const users = db.collection("user");
const transactions = db.collection("transactions");
const sessions = db.collection("session");

app.use(express.json());

// Convert a value to an ObjectId when it is a valid id string.
function toObjectId(value) {
  const raw = String(value || "");

  if (!ObjectId.isValid(raw)) {
    return null;
  }

  return new ObjectId(raw);
}

// Read the better-auth session token sent as "Authorization: Bearer <token>".
function getBearerToken(req) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return "";
  }

  return header.slice(7).trim();
}

// Resolve the current user from the shared better-auth session collection.
async function resolveSessionUser(req) {
  const token = getBearerToken(req);

  if (!token) {
    return null;
  }

  const session = await sessions.findOne({ token });

  if (!session) {
    return null;
  }

  const expiresAt = session.expiresAt ? new Date(session.expiresAt) : null;

  if (
    !expiresAt ||
    Number.isNaN(expiresAt.getTime()) ||
    expiresAt <= new Date()
  ) {
    return null;
  }

  const userId = toObjectId(session.userId);
  const user = userId ? await users.findOne({ _id: userId }) : null;

  if (!user) {
    return null;
  }

  return {
    id: String(user._id),
    email: user.email,
    name: user.name || "",
    role: user.role || "customer",
    banned: Boolean(user.banned || user.isBlocked),
  };
}

// Authentication middleware for routes that need the current user.
async function requireAuth(req, res, next) {
  try {
    const user = await resolveSessionUser(req);

    if (!user) {
      return res.status(401).send({
        success: false,
        message: "Authentication required",
      });
    }

    if (user.banned) {
      return res.status(403).send({
        success: false,
        message: "Your account has been blocked",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error("Authentication error:", error);

    res.status(500).send({
      success: false,
      message: "Authentication failed",
    });
  }
}

// Restrict a route to administrators.
function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).send({
      success: false,
      message: "Admin access required",
    });
  }

  next();
}

// Allow the authenticated owner of a resource (or an admin).
function isOwnerOrAdmin(user, ownerId) {
  return user?.role === "admin" || String(user?.id) === String(ownerId);
}

app.get("/", (req, res) => {
  res.send({ message: "Weading plan server runnig" });
});

// Get all submitted services
app.get("/services", async (req, res) => {
  const result = await services.find().toArray();
  res.send(result);
});

// Get all submitted services approved and active for customer
app.get("/customer/services", async (req, res) => {
  const query = { status: "approved", isActive: true };
  const result = await services.find(query).toArray();
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
    featured: true,
  };

  const result = await services.find(query).limit(3).toArray();
  res.send(result);
});

// Get all service categories
app.get("/services/categories", async (req, res) => {
  const result = await services.distinct("category");

  res.send(result);
});

// Create a new service vendor
app.post("/services", requireAuth, async (req, res) => {
  try {
    const { serviceName, category, description, price, location, images } =
      req.body;

    const vendorId =
      req.user.role === "admin"
        ? req.body.vendorId || req.user.id
        : req.user.id;

    if (!["vendor", "admin"].includes(req.user.role)) {
      return res.status(403).send({
        success: false,
        message: "Only vendors can create services",
      });
    }

    console.log("Received Service Data:", req.body);

    if (!vendorId) {
      return res.status(400).send({
        success: false,
        message: "Vendor ID is required",
      });
    }

    // 1. Find vendor subscription
    const vendor = await users.findOne(
      { _id: new ObjectId(vendorId) },
      {
        projection: {
          subscriptionPlan: 1,
        },
      },
    );

    if (!vendor) {
      return res.status(404).send({
        success: false,
        message: "Vendor not found",
      });
    }

    // 2. Count active services
    const activeServiceCount = await services.countDocuments({
      vendorId,
      isActive: true,
    });

    // 3. Free plan limit
    if (vendor.subscriptionPlan !== "premium" && activeServiceCount >= 3) {
      return res.status(403).send({
        success: false,
        upgradeRequired: true,
        message:
          "Free plan allows maximum 3 active services. Upgrade to Premium.",
      });
    }

    const newService = {
      serviceName,
      category,
      description,
      price: Number(price),
      location,
      images,
      vendorId,
      vendorEmail: req.user.email,
      vendorName: req.user.name,
      featured: false,
      isActive: true,
      status: "pending",
      createdAt: new Date(),
    };

    const result = await services.insertOne(newService);

    res.status(201).send({
      success: true,
      message: "Service created successfully",
      insertedId: result.insertedId,
    });
  } catch (error) {
    console.error("Create Service Error:", error);

    res.status(500).send({
      success: false,
      message: error.message,
    });
  }
});

// Update own service vendor
app.patch("/services/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  const { vendorId: bodyVendorId, ...updateData } = req.body;

  const vendorId =
    req.user.role === "admin" ? bodyVendorId || req.user.id : req.user.id;

  if (!ObjectId.isValid(id)) {
    return res.status(400).send({
      success: false,
      message: "Invalid service ID",
    });
  }

  const filter = {
    _id: new ObjectId(id),
    vendorId,
  };

  const updatedDoc = {
    $set: {
      ...updateData,
      updatedAt: new Date(),
    },
  };

  const result = await services.updateOne(filter, updatedDoc);
  res.send(result);
});

// Update service availability vendor
app.patch("/services/:id/availability", requireAuth, async (req, res) => {
  const { id } = req.params;
  const { isActive } = req.body;

  const vendorId =
    req.user.role === "admin" ? req.body.vendorId || req.user.id : req.user.id;

  if (!ObjectId.isValid(id)) {
    return res.status(400).send({
      success: false,
      message: "Invalid service ID",
    });
  }

  if (typeof isActive !== "boolean") {
    return res.status(400).send({
      success: false,
      message: "Availability is required",
    });
  }

  const filter = {
    _id: new ObjectId(id),
    vendorId,
    status: "approved",
  };

  const result = await services.updateOne(filter, {
    $set: {
      isActive,
      updatedAt: new Date(),
    },
  });

  if (result.matchedCount === 0) {
    return res.status(404).send({
      success: false,
      message: "Approved service not found",
    });
  }

  res.send({
    success: true,
    message: "Availability updated successfully",
    result,
  });
});

// Delete own service vendor
app.delete("/services/:id", requireAuth, async (req, res) => {
  const { id } = req.params;

  const vendorId =
    req.user.role === "admin" ? req.body?.vendorId || req.user.id : req.user.id;

  if (!ObjectId.isValid(id)) {
    return res.status(400).send({
      success: false,
      message: "Invalid service ID",
    });
  }

  const query = {
    _id: new ObjectId(id),
    vendorId,
  };

  const result = await services.deleteOne(query);
  res.send(result);
});

// Create booking request customer
app.post("/bookings", requireAuth, async (req, res) => {
  const { serviceId, eventDate, eventLocation, message } = req.body;

  if (!ObjectId.isValid(String(serviceId || ""))) {
    return res.status(400).send({
      success: false,
      message: "A valid service is required",
    });
  }

  // 1. Find service from database
  const service = await services.findOne({
    _id: new ObjectId(serviceId),
  });

  // 2. Check service exists
  if (!service) {
    return res.status(404).send({
      message: "Service not found",
    });
  }

  const vendorObjectId = toObjectId(service.vendorId);
  const vendor = vendorObjectId
    ? await users.findOne({ _id: vendorObjectId })
    : null;

  const booking = {
    serviceId,
    serviceName: service.serviceName || "",
    image: Array.isArray(service.images) ? service.images[0] || "" : "",
    vendorId: service.vendorId,
    vendorEmail: service.vendorEmail || vendor?.email || "",
    vendorName: service.vendorName || vendor?.name || "",
    customerId: req.user.id,
    customerEmail: req.user.email,
    customerName: req.user.name,
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
app.get("/my-bookings/:email", requireAuth, async (req, res) => {
  const email = req.params.email;

  if (req.user.role !== "admin" && email !== req.user.email) {
    return res.status(403).send({ message: "Access denied" });
  }

  const query = {
    customerEmail: email,
  };

  const result = await bookings.find(query).toArray();
  res.send(result);
});

// Get booking details
app.get("/bookings/:id", requireAuth, async (req, res) => {
  const id = req.params.id;

  if (!ObjectId.isValid(id)) {
    return res.status(400).send({ message: "Invalid booking ID" });
  }

  const query = {
    _id: new ObjectId(id),
  };

  const result = await bookings.findOne(query);

  if (!result) {
    return res.status(404).send({ message: "Booking not found" });
  }

  if (
    req.user.role !== "admin" &&
    result.customerEmail !== req.user.email &&
    result.vendorEmail !== req.user.email &&
    String(result.customerId) !== req.user.id &&
    String(result.vendorId) !== req.user.id
  ) {
    return res.status(403).send({ message: "Access denied" });
  }

  res.send(result);
});

// Delete pending booking by customer
app.delete("/bookings/:id", requireAuth, async (req, res) => {
  const id = req.params.id;

  if (!ObjectId.isValid(id)) {
    return res.status(400).send({
      success: false,
      message: "Invalid booking ID",
    });
  }

  const query = {
    _id: new ObjectId(id),
    status: "pending", // Only pending bookings can be deleted
  };

  if (req.user.role !== "admin") {
    query.customerEmail = req.user.email;
  }

  const result = await bookings.deleteOne(query);

  if (result.deletedCount === 0) {
    return res.status(404).send({
      success: false,
      message:
        "Booking not found or cannot be deleted. Only pending bookings can be deleted.",
    });
  }

  res.send({
    success: true,
    message: "Booking deleted successfully.",
    deletedCount: result.deletedCount,
  });
});

// Get own services vendor
app.get("/vendor/services/:vendorId", requireAuth, async (req, res) => {
  const { vendorId } = req.params;

  if (!isOwnerOrAdmin(req.user, vendorId)) {
    return res.status(403).send({ message: "Access denied" });
  }

  const result = await services
    .find({ vendorId })
    .sort({ createdAt: -1 })
    .toArray();
  res.send(result);
});

// Get vendor booking requests
app.get("/vendor/bookings/:vendorId", requireAuth, async (req, res) => {
  try {
    const { vendorId } = req.params;

    if (!isOwnerOrAdmin(req.user, vendorId)) {
      return res.status(403).send({ message: "Access denied" });
    }

    const query = {
      vendorId: vendorId,
    };

    const result = await bookings.find(query).sort({ createdAt: -1 }).toArray();

    res.send(result);
  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Failed to fetch vendor bookings",
    });
  }
});

// Accept or reject bookings vendor
app.patch("/vendor/bookings/:id/status", requireAuth, async (req, res) => {
  const id = req.params.id;
  const { status } = req.body;

  const vendorId =
    req.user.role === "admin" ? req.body.vendorId || req.user.id : req.user.id;

  if (!["accepted", "rejected"].includes(status)) {
    return res.status(400).send({
      message: "Invalid booking status",
    });
  }

  if (!ObjectId.isValid(id)) {
    return res.status(400).send({ message: "Invalid booking ID" });
  }

  const query = {
    _id: new ObjectId(id),
    vendorId: vendorId,
    status: "pending",
  };

  const updatedDoc = {
    $set: {
      status: status,
      updatedAt: new Date(),
    },
  };

  const result = await bookings.updateOne(query, updatedDoc);

  if (result.matchedCount === 0) {
    return res.status(404).send({
      message: "Booking not found or already processed",
    });
  }

  res.send({
    success: true,
    message: `Booking ${status} successfully`,
  });
});

// Get vendor dashboard overview
app.get("/vendor/dashboard", requireAuth, async (req, res) => {
  try {
    const vendorId =
      req.user.role === "admin"
        ? req.query.vendorId || req.user.id
        : req.user.id;

    if (!vendorId) {
      return res.status(400).send({
        success: false,
        message: "Vendor ID is required",
      });
    }

    // Total services
    const totalServices = await services.countDocuments({
      vendorId: vendorId,
    });

    // Total bookings
    const totalBookings = await bookings.countDocuments({
      vendorId: vendorId,
    });

    const pendingBookings = await bookings.countDocuments({
      status: "pending",
      vendorId: vendorId,
    });

    const acceptedBookings = await bookings.countDocuments({
      status: "accepted",
      vendorId: vendorId,
    });

    const rejectedBookings = await bookings.countDocuments({
      status: "rejected",
      vendorId: vendorId,
    });

    const cancelledBookings = await bookings.countDocuments({
      vendorId: vendorId,
      status: "cancelled",
    });

    res.send({
      success: true,
      totalServices,
      totalBookings,
      pendingBookings,
      acceptedBookings,
      rejectedBookings,
      cancelledBookings,
    });
  } catch (error) {
    console.error("Vendor dashboard error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to load vendor dashboard",
    });
  }
});

app.post("/payments/checkout-verify", async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).send({
        success: false,
        message: "Session ID required",
      });
    }

    // Get stripe session
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    const {
      status,
      payment_status,
      metadata,
      amount_total,
      currency,
      subscription,
    } = session;

    if (status !== "complete" || payment_status !== "paid") {
      return res.send({
        success: false,
        message: "Payment verification failed",
      });
    }

    const vendorId = metadata.vendorId;
    const plan = metadata.plan || "premium";

    if (!vendorId) {
      return res.status(400).send({
        success: false,
        message: "Vendor ID missing from metadata",
      });
    }

    // Prevent duplicate payment
    const existingTransaction = await transactions.findOne({
      stripeSessionId: sessionId,
    });

    if (existingTransaction) {
      return res.send({
        success: false,
        message: "Payment already verified",
      });
    }

    // Save transaction
    // Save transaction
    const transaction = {
      vendorId: vendorId,
      plan: plan,
      amount: amount_total / 100,
      currency: currency,
      stripeSessionId: sessionId,
      stripeSubscriptionId: subscription || null,
      // customerEmail: customerEmail,
      status: "paid",
      createdAt: new Date(),
    };

    const transactionResult = await transactions.insertOne(transaction);

    // Update vendor subscription
    const updateResult = await users.updateOne(
      {
        _id: new ObjectId(vendorId),
      },
      {
        $set: {
          subscriptionPlan: "premium",
          subscriptionStatus: "active",
          subscriptionUpdatedAt: new Date(),
        },
      },
    );

    res.send({
      success: true,
      message: "Payment verified successfully",
      transactionResult,
      updateResult,
    });
  } catch (error) {
    console.error("Payment Verify Error:", error);

    res.status(500).send({
      success: false,
      message: error.message,
    });
  }
});

// Get customer dashboard overview
app.get("/customer/dashboard", requireAuth, async (req, res) => {
  try {
    const email =
      req.user.role === "admin"
        ? req.query.email || req.user.email
        : req.user.email;

    if (!email) {
      return res.status(400).send({
        success: false,
        message: "Customer email is required",
      });
    }

    const bookingsData = await bookings
      .find({ customerEmail: email })
      .sort({ createdAt: -1 })
      .toArray();

    const totalBookings = bookingsData.length;

    const pendingBookings = bookingsData.filter(
      (booking) => booking.status === "pending",
    ).length;

    const acceptedBookings = bookingsData.filter(
      (booking) => booking.status === "accepted",
    ).length;

    const rejectedBookings = bookingsData.filter(
      (booking) => booking.status === "rejected",
    ).length;

    return res.status(200).send({
      success: true,
      totalBookings,
      pendingBookings,
      acceptedBookings,
      rejectedBookings,
      recentBookings: bookingsData.slice(0, 5),
    });
  } catch (error) {
    console.error("Customer Dashboard Error:", error);

    return res.status(500).send({
      success: false,
      message: "Failed to fetch customer dashboard",
    });
  }
});

// Get customer booking statistics
app.get("/customer/statistics", requireAuth, async (req, res) => {
  const email = req.user.email;

  const result = await bookings
    .aggregate([
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
    ])
    .toArray();

  res.send(
    result[0] || {
      totalBookings: 0,
      pendingBookings: 0,
      acceptedBookings: 0,
      rejectedBookings: 0,
      cancelledBookings: 0,
    },
  );
});

// Get customer bookings
app.get("/customer/bookings", async (req, res) => {
  const query = {
    customerEmail: req.user.email,
  };

  const result = await bookings
    .find(query)
    .sort({
      createdAt: -1,
    })
    .toArray();

  res.send(result);
});

// Get all services admin with search and filter
app.get("/admin/services", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { search = "", status = "", category = "" } = req.query;

    const query = {};

    // Search by service name or vendor id
    if (search) {
      query.$or = [
        {
          serviceName: {
            $regex: search,
            $options: "i",
          },
        },
        {
          vendorId: {
            $regex: search,
            $options: "i",
          },
        },
      ];
    }

    // Filter by status
    if (status && status !== "all") {
      query.status = status;
    }

    // Filter by category
    if (category && category !== "all") {
      query.category = category;
    }

    const result = await services.find(query).sort({ createdAt: -1 }).toArray();

    res.send(result);
  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Failed to fetch services",
    });
  }
});

// all services admin with update status
app.patch(
  "/admin/services/:id/status",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const id = req.params.id;
    const { status } = req.body;

    if (!["approved", "rejected", "pending"].includes(status)) {
      return res.status(400).send({
        message: "Invalid status",
      });
    }

    const result = await services.updateOne(
      {
        _id: new ObjectId(id),
      },
      {
        $set: {
          status,
          isActive: status === "approved",
          updatedAt: new Date(),
        },
      }
    );


    if (!result.matchedCount) {
      return res.status(404).send({
        message: "Service not found",
      });
    }


    res.send({
      success: true,
      message: `Service status changed to ${status}`,
      result,
    });
  }
);

// all services admin with update active status toggle
app.patch(
  "/admin/services/:id/toggle",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const id = req.params.id;

    const { isActive } = req.body;

    const result = await services.updateOne(
      {
        _id: new ObjectId(id),
      },
      {
        $set: {
          isActive,
          updatedAt: new Date(),
        },
      },
    );

    res.send(result);
  },
);

// all services admin with delete service
app.delete(
  "/admin/services/:id",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const id = req.params.id;

    const result = await services.deleteOne({
      _id: new ObjectId(id),
    });

    res.send(result);
  },
);

// Get all transactions (admin)
app.get("/admin/transactions", requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await transactions.find().sort({ createdAt: -1 }).toArray();

    res.send(result);
  } catch (error) {
    console.error("Admin transactions error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to fetch transactions",
    });
  }
});

// Get admin dashboard overview
app.get("/admin/dashboard", requireAuth, requireAdmin, async (req, res) => {
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

  const totalTransactions = await transactions.countDocuments();

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
app.get("/admin/users", requireAuth, requireAdmin, async (req, res) => {
  const result = await users.find().toArray();

  res.send(result);
});

// Get user details
app.get("/admin/users/:id", requireAuth, requireAdmin, async (req, res) => {
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
app.patch(
  "/admin/users/:id/block",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const id = req.params.id;

    const query = {
      _id: new ObjectId(id),
      role: { $ne: "admin" },
    };

    const updatedDoc = {
      $set: {
        isBlocked: true,
        banned: true,
        updatedAt: new Date(),
      },
    };

    const result = await users.updateOne(query, updatedDoc);

    res.send(result);
  },
);

// Unblock user
app.patch(
  "/admin/users/:id/unblock",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const id = req.params.id;

    const query = {
      _id: new ObjectId(id),
      role: { $ne: "admin" },
    };

    const updatedDoc = {
      $set: {
        isBlocked: false,
        banned: false,
        updatedAt: new Date(),
      },
    };

    const result = await users.updateOne(query, updatedDoc);

    res.send(result);
  },
);

app.listen(port, () => {
  console.log(`Weading plan app listening on port ${port}`);
});
