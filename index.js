const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

require("dotenv").config();
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const jwt =require("jsonwebtoken")

app.use(express.json());
app.use(cors());

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








    
    // user related Apis
    app.post('/users', verifyToken, verifyAdmin, async (req, res) => {
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
      const imageUrl = `http://localhost:${port}/uploads/${req.file.filename}`;
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

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});