const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 5000;
module.exports = app;
app.listen(port, () => console.log(`Server running on port ${port}`));

require("dotenv").config();
app.use(cors({
    origin: [
        "http://localhost:5173", 
        "https://TicketBari223.vercel.app" // ⚠️ CHANGE THIS to your actual Vercel link
    ],
    credentials: true
}));


const multer = require('multer');
const path = require('path');
const jwt =require("jsonwebtoken")

app.use(express.json());
app.use(cors());




const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Serve uploaded images
app.use('/uploads', express.static('uploads'));

// Multer storage configuration
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, './uploads'); // save to ./uploads
  },
  filename: function(req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname)); // unique filename
  }
});

const upload = multer({ storage });

// MongoDB setup
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const { log } = require('console');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@mongopractice.2tbsahv.mongodb.net/?appName=MongoPractice`;
const client = new MongoClient(uri, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
});

// JWT Middleware for Verification (Add this function)

const verifyToken =(req, res,next)=>{
  const authHeader =req.headers.authorization


  
  if(!authHeader){
    return res.status(401).send({message:"Unauthorized access: Missing token"})
  }

const token =authHeader.split(" ")[1];
console.log("Authorization Header Received:", authHeader);
    console.log("Token Extracted:", token ? token.substring(0, 20) + '...' : 'Failed to extract');
jwt.verify(token,process.env.ACCESS_TOKEN_SECRET,(err,decoded)=>{

  if (err) {
            console.error("JWT Verification Error:", err);
            return res.status(403).send({ message: 'Forbidden access: Invalid token' });
        }
        req.decoded = decoded; 
        next();

      })
}








async function run() {
  try {
    await client.connect();
    const ticketDB = client.db("ticketbari-db");
    const ticketCollection = ticketDB.collection("tickets");
    const usersCollection = ticketDB.collection("users");
    const bookingCollection = ticketDB.collection("bookings");
    const paymentCollection = ticketDB.collection("payments");

    app.post('/jwt', async (req, res) => {
    const userEmail = req.body.email;
    
    // 1. Fetch the user's current role from MongoDB
    const query = { email: userEmail };
    const dbUser = await usersCollection.findOne(query);

    // 2. Prepare the payload (includes role)
    const payload = { 
        email: userEmail,
        role: dbUser ? dbUser.role : 'user' // Default to 'user' if not found (shouldn't happen)
    };
    
    // 3. Sign the token with the enhanced payload
    // ⚠️ IMPORTANT: ACCESS_TOKEN_SECRET must be in your .env file
    const token = jwt.sign(payload, process.env.ACCESS_TOKEN_SECRET, { 
        expiresIn: '7d' 
    });
    
    res.send({ token });
}); 


const verifyAdmin = (req, res, next) => {
    // req.decoded is set by verifyToken
    if (req.decoded.role !== 'admin') {
        return res.status(403).send({ message: 'Forbidden access: Requires Admin role' });
    }
    next();
};

// Middleware to check if the user is a Vendor
const verifyVendor = (req, res, next) => {
    if (req.decoded.role !== 'vendor') {
        return res.status(403).send({ message: 'Forbidden access: Requires Vendor role' });
    }
    next();
};

// Middleware to check if the user is a User (standard consumer)
const verifyUser = (req, res, next) => {
    if (req.decoded.role !== 'user') {
        // We generally don't deny access to a 'user' but it's good practice
        return res.status(403).send({ message: 'Forbidden access: Requires User role' });
    }
    next();
};

app.get('/tickets/advertised', async (req, res) => {
    const result = await ticketCollection
        .find({ isAdvertised: true, status: 'approved' })
        .limit(6)
        .toArray();
    res.send(result);
});

// 2. Get Latest Tickets (e.g., last 8 added)
app.get('/tickets/latest', async (req, res) => {
    const result = await ticketCollection
        .find({ status: 'approved' })
        .sort({ _id: -1 }) // Sorts by newest first
        .limit(8)
        .toArray();
    res.send(result);
});


// create Payment intent 
app.post("/create-payment-intent", verifyToken, async (req, res) => {
    const { price } = req.body;
    const amount = parseInt(price * 100); // Stripe works in cents

    const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
    });

    res.send({ clientSecret: paymentIntent.client_secret });
});

// Save Payment Info & Update Booking Status
app.post("/payments", verifyToken, async (req, res) => {
    const payment = req.body;
    try {
        // 1. Save payment info
        const insertResult = await paymentCollection.insertOne(payment);

        // 2. Update booking status to "paid"
        const filter = { _id: new ObjectId(payment.bookingId) };
        await bookingCollection.updateOne(filter, { 
            $set: { status: "paid", transactionId: payment.transactionId } 
        });

        // 3. REDUCE TICKET QUANTITY
        const ticketFilter = { _id: new ObjectId(payment.ticketId) };
        const ticketUpdate = { $inc: { quantity: -payment.quantity } };
        await ticketCollection.updateOne(ticketFilter, ticketUpdate);

        res.send({ paymentResult: insertResult });
    } catch (error) {
        res.status(500).send("Payment processing failed");
    }
});

// GET transaction history for a specific user
app.get('/payments/:email', verifyToken, async (req, res) => {
    const email = req.params.email;
    const decodedEmail = req.decoded.email;

    if (email !== decodedEmail) {
        return res.status(403).send({ message: 'forbidden access' });
    }

    const query = { userEmail: email };
    // Sort by date newest first
    const result = await paymentCollection.find(query).sort({ date: -1 }).toArray();
    res.send(result);
});

// Payment Intent Error Handling
app.post("/create-payment-intent", verifyToken, async (req, res) => {
    try {
        const { price } = req.body;
        if (!price || price <= 0) return res.status(400).send({ message: "Invalid price" });

        const amount = parseInt(price * 100); 

        const paymentIntent = await stripe.paymentIntents.create({
            amount: amount,
            currency: "usd",
            payment_method_types: ["card"],
        });

        res.send({ clientSecret: paymentIntent.client_secret });
    } catch (error) {
        console.error("Stripe Error:", error.message);
        res.status(500).send({ error: error.message });
    }
});



// Admin Stats API
app.get('/vendor-stats', verifyToken, verifyVendor, async (req, res) => {
    try {
        const totalTickets = await ticketCollection.estimatedDocumentCount();
        const payments = await paymentCollection.find().toArray();
        
        // Calculate total revenue from all payment records
        const revenue = payments.reduce((total, payment) => total + payment.amount, 0);
        
        // Count total tickets sold (assuming 1 payment = tickets sold)
        // Or you can sum up payment.quantity if you have it
        const ticketsSold = await paymentCollection.countDocuments();

        res.send({
            totalTickets,
            ticketsSold,
            revenue: revenue.toFixed(2)
        });
    } catch (error) {
        res.status(500).send({ message: "Could not fetch stats" });
    }
});





// ADvertise Tickets
app.patch('/tickets/advertise/:id',verifyToken, verifyAdmin,async(req,res)=>{

const id =req.params.id
const {isAdvertised}=req.body
try{
  if(isAdvertised === true){
   const currentAdsCount = await ticketCollection.countDocuments({ isAdvertised: true });
   if (currentAdsCount >= 6) {
                return res.status(400).send({ message: "You can only advertise up to 6 tickets at a time!" });
            }
}


const result =await ticketCollection.updateOne(
  {_id :new ObjectId(id)},
  {$set: {isAdvertised :isAdvertised}}

  
)
res.send (result)

}
catch (error){
  res.status(500).send({message:"Internal Server Error "})
}
})









app.get('/tickets/admin/all', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const result = await ticketCollection.find().toArray();
        res.send(result);
    } catch (error) {
        console.error("Error fetching all tickets for admin:", error);
        res.status(500).send({ message: "Server error while fetching tickets." });
    }
});

// tickets approving
app.patch('/tickets/status/:id', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        const { status } = req.body; // Expects status: 'approved' or 'rejected'
        
        if (!['approved', 'rejected'].includes(status)) {
            return res.status(400).send({ message: "Invalid status value provided." });
        }

        const result = await ticketCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { status: status } }
        );

        res.send(result);
    } catch (error) {
        console.error("Error updating ticket status:", error);
        res.status(500).send({ message: "Server error during status update." });
    }
});



// GET ALL APPROVED TICKETS (Publicly accessible, filtered)
app.get('/tickets/approved', async (req, res) => {
    try {
        // Fetch tickets that are approved AND not hidden (not fraud)
        const result = await ticketCollection.find({ status: 'approved', isFraud: { $ne: true } }).toArray();
        res.send(result);
    } catch (error) {
        console.error("Error fetching approved tickets:", error);
        res.status(500).send({ message: "Server error." });
    }
});


// --- PUBLIC: GET ALL APPROVED TICKETS (FOR "All Tickets" Page) ---

app.get('/tickets/all', async (req, res) => {
    try {
        // Fetch tickets that are approved AND not hidden (not fraud)
        const query = { 
            status: 'approved', 
            // Ensures tickets from fraud vendors are excluded
            isFraud: { $ne: true } 
        };
        
        // This is where you would also apply pagination, sorting, and filtering (challenge requirements)
        const result = await ticketCollection.find(query).toArray();
        res.send(result);
    } catch (error) {
        console.error("Error fetching approved tickets for All Tickets page:", error);
        res.status(500).send({ message: "Server error." });
    }
});



// PATCH TICKET ADVERTISE STATUS (and enforce 6 limit)
app.patch('/tickets/advertise/:id', verifyToken, verifyAdmin, async (req, res) => {
    const id = req.params.id;
    const { isAdvertised } = req.body; 

    try {
        // If Admin is trying to advertise (set to true)
        if (isAdvertised) {
            const advertisedCount = await ticketCollection.countDocuments({ isAdvertised: true });
            
            // Check if the limit of 6 has been reached
            if (advertisedCount >= 6) {
                return res.status(400).send({ message: "Cannot advertise more than 6 tickets." });
            }
        }
        
        // Perform the update
        const result = await ticketCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { isAdvertised: isAdvertised } }
        );

        res.send(result);

    } catch (error) {
        console.error("Error updating advertise status:", error);
        res.status(500).send({ message: "Server error." });
    }
});

// Get bookings for the logged-in user

app.get('/my-bookings/:email', verifyToken, async (req, res) => {
    const email = req.params.email;
    // Security check: Ensure the requested email matches the token email
   const decodedEmail = req.decoded.email;
   console.log("URL Email:", email);
    console.log("Token Email:", decodedEmail);
   
    if (email !== req.decoded.email) {
        return res.status(403).send({ message: 'forbidden access' });
    }
    const query = { userEmail: email };
    const result = await bookingCollection.find(query).toArray();
    res.send(result);
});


// get booking info from users

app.get("/vendor-bookings/:email",verifyToken,verifyVendor,async(req,res)=>{
  const email = req.params.email;
  if (email !== req.decoded.email) {
        return res.status(403).send({ message: 'forbidden access' });
    }

const query ={vendorEmail:email};
const result =await bookingCollection.find(query).toArray()
res.send(result)
})

// Vendor action: Accept or Reject a user's booking
app.patch('/bookings/status/:id', verifyToken, verifyVendor, async (req, res) => {
    const id = req.params.id;
    const { status } = req.body; // 'accepted' or 'rejected'
    
    const filter = { _id: new ObjectId(id) };
    const updateDoc = {
        $set: { status: status }
    };
    
    const result = await bookingCollection.updateOne(filter, updateDoc);
    res.send(result);
});






    
    // user related Apis
    app.post('/users', async (req, res) => {
  const user = req.body;

  const exists = await usersCollection.findOne({ email: user.email });
  if (exists) {
    return res.send({ message: "User already exists" });
  }

  user.role = "user";
  user.isFraud = false;
  user.createdAt = new Date();

  const result = await usersCollection.insertOne(user);
  res.send(result);
});


app.get('/users', verifyToken, verifyAdmin, async (req, res) => { // ⬅️ THIS ROUTE IS NEEDED
    try {
        const result = await usersCollection.find().toArray();
        res.send(result);
    } catch (error) {
        console.error("Error fetching all users:", error);
        res.status(500).send({ message: "Server error while fetching users." });
    }
});





app.get('/users/:email',verifyToken ,  async (req, res) => {
    try {
        const email = req.params.email;
        const query = { email: email };
        const user = await usersCollection.findOne(query);

        if (!user) {
            return res.status(404).send({ message: "User not found" });
        }
        res.send(user);
    } catch (error) {
        console.error("Error fetching user:", error);
        res.status(500).send({ message: "Server error" });
    }
});


app.patch('/users/role/:email',verifyToken , verifyAdmin,  async (req, res) => {
  const email = req.params.email;
  const role = req.body.role;

  const result = await usersCollection.updateOne(
    { email },
    { $set: { role } }
  );

  res.send(result);
});
    


// for fraud
app.patch('/users/fraud/:email',verifyToken , verifyAdmin, async (req, res) => {
  const email = req.params.email;

  const result = await usersCollection.updateOne(
    { email },
    { $set: { isFraud: true } }
  );

  
  await ticketCollection.updateMany(
    { vendorEmail: email },
    { $set: { status: "hidden" } }
  );

  res.send(result);
});
    
    
    
    
    
    // Ticket creation

app.get('/tickets/:id', verifyToken, async (req, res) => {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await ticketCollection.findOne(query);
    res.send(result);
});


// --- POST: Save a new booking ---
app.post('/bookings', verifyToken, async (req, res) => {
    const booking = req.body;
    
    // Optional: Double check availability on server side
    const ticketId = booking.ticketId;
    const ticket = await ticketCollection.findOne({ _id: new ObjectId(ticketId) });
    
    if (!ticket || ticket.quantity < booking.quantity) {
        return res.status(400).send({ message: "Insufficient ticket quantity" });
    }

    const result = await bookingCollection.insertOne(booking);
    res.send(result);
});





    app.post('/tickets',verifyToken ,verifyVendor, async (req, res) => {
      const ticket = req.body;
      const result = await ticketCollection.insertOne(ticket);
      res.send(result);
    });

     app.get('/tickets/vendor/:email',verifyToken , verifyVendor, async (req, res) => {
      const email = req.params.email;

      const tickets = await ticketCollection
        .find({ vendorEmail: email })
        .toArray();

      res.send(tickets);
    });


   app.delete('/tickets/:id',verifyToken , async (req, res) => {
  const id = req.params.id;
  const { ObjectId } = require('mongodb');

  try {
    const result = await ticketCollection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).send({ message: "Ticket not found" });
    }

    res.send({ message: "Deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Server error" });
  }
});

   








    // Image upload route
    app.post('/api/upload', upload.single('image'), (req, res) => {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const baseUrl = process.env.NODE_ENV === 'production' 
    ? "https://your-actual-server-link.vercel.app" // ⚠️ Replace with your SERVER Vercel link
    : `http://localhost:${port}`;
     const imageUrl = `${baseUrl}/uploads/${req.file.filename}`;
  res.json({ url: imageUrl });
    });

    console.log("MongoDB connected and routes are ready");
  } finally {
    // client.close() // keep connection alive
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Hello World!');
});

if (process.env.NODE_ENV !== 'production') {
    app.listen(port, () => {
        console.log(`Server running on port ${port}`);
    });
}