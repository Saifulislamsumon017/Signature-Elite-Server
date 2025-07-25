require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
app.use(express.json());
app.use(cookieParser());

// JWT middleware
const verifyJWT = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).send({ message: 'Unauthorized' });

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).send({ message: 'Forbidden' });
    req.user = decoded;
    next();
  });
};

// MongoDB Connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@signatureelite.z7ote26.mongodb.net/?retryWrites=true&w=majority&appName=SignatureElite`;

const client = new MongoClient(uri, {
  serverApi: ServerApiVersion.v1,
});

async function run() {
  try {
    // await client.connect();
    console.log('✅ Connected to MongoDB');

    const db = client.db('signatureElite');
    const usersCollection = db.collection('users');
    const propertiesCollection = db.collection('properties');
    const wishlistCollection = db.collection('wishlists');
    const reviewsCollection = db.collection('reviews');
    const offersCollection = db.collection('offers');

    // --- AUTH ---
    // JWT route - issue token
    app.post('/jwt', async (req, res) => {
      const { email } = req.body;
      if (!email) return res.status(400).send({ message: 'Email is required' });
      const user = await usersCollection.findOne({ email });
      if (!user) return res.status(401).send({ message: 'Unauthorized' });

      const token = jwt.sign(
        { email: user.email, role: user.role || 'user' },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );
      res.send({ token });
    });
    // --- USER ROLE ---

    app.get('/users/role', verifyJWT, async (req, res) => {
      const email = req.user.email;

      if (!email)
        return res.status(400).send({ message: 'Email not found in token' });

      try {
        const user = await usersCollection.findOne({ email });
        if (!user) return res.status(404).send({ role: null });

        res.send({ role: user.role });
      } catch (err) {
        res.status(500).send({ message: 'Error fetching user role' });
      }
    });

    app.post('/users', async (req, res) => {
      const email = req.body.email;
      const userExists = await usersCollection.findOne({ email });
      if (userExists) {
        return res
          .status(200)
          .send({ message: 'User already exists', inserted: false });
      }
      const user = req.body;
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    // --- PROPERTIES ---

    app.get('/all-properties', async (req, res) => {
      const { search = '', sort = '' } = req.query;
      const query = { verificationStatus: 'verified' };

      if (search) query.location = { $regex: search, $options: 'i' };

      let sortOption = {};
      if (sort === 'asc') sortOption.minPrice = 1;
      if (sort === 'desc') sortOption.minPrice = -1;

      const properties = await propertiesCollection
        .find(query)
        .sort(sortOption)
        .toArray();
      res.send(properties);
    });

    // Get single property details by ID - public or protected (your choice)
    app.get('/property/:id', async (req, res) => {
      const id = req.params.id;
      const property = await propertiesCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(property);
    });

    app.get('/advertised-properties', async (req, res) => {
      const advertised = await propertiesCollection
        .find({ advertised: true, verificationStatus: 'verified' })
        .limit(4)
        .toArray();
      res.send(advertised);
    });

    // --- WISHLIST ---
    // GET wishlist items for a user
    // GET: Wishlist Items
    app.get('/wishlist', async (req, res) => {
      try {
        const userEmail = req.query.userEmail;
        if (!userEmail) {
          return res.status(400).send({ message: 'userEmail is required' });
        }

        const items = await wishlistCollection.find({ userEmail }).toArray();
        res.send(items);
      } catch (error) {
        console.error('Error fetching wishlist:', error);
        res.status(500).send({ message: 'Internal server error' });
      }
    });

    // POST: Add to Wishlist
    app.post('/wishlist', async (req, res) => {
      const {
        userEmail,
        propertyId,
        title,
        image,
        location,
        minPrice,
        maxPrice,
        agentName,
        agentImage,
        verificationStatus,
      } = req.body;

      if (!userEmail || !propertyId) {
        return res.status(400).send({ message: 'Missing required fields' });
      }

      try {
        const exists = await wishlistCollection.findOne({
          userEmail,
          propertyId,
        });
        if (exists) {
          return res.status(409).send({ message: 'Already in wishlist' });
        }

        const result = await wishlistCollection.insertOne({
          userEmail,
          propertyId,
          title,
          image,
          location,
          minPrice,
          maxPrice,
          agentName,
          agentImage,
          verificationStatus,
          createdAt: new Date(),
        });

        res.send({ success: true, insertedId: result.insertedId });
      } catch (error) {
        console.error('Error adding to wishlist:', error);
        res.status(500).send({ message: 'Internal server error' });
      }
    });

    // DELETE: Remove from Wishlist
    app.delete('/wishlist/:propertyId', verifyJWT, async (req, res) => {
      try {
        const propertyId = req.params.propertyId;
        const userEmail = req.query.userEmail;

        if (!propertyId || !userEmail) {
          return res
            .status(400)
            .send({ message: 'propertyId and userEmail required' });
        }

        const result = await wishlistCollection.deleteOne({
          _id: new ObjectId(propertyId),
          userEmail,
        });

        console.log(result);

        if (result.deletedCount === 0) {
          return res.status(404).send({ message: 'Wishlist item not found' });
        }

        res.send({ message: 'Wishlist item removed' });
      } catch (error) {
        console.error('Error removing wishlist item:', error);
        res.status(500).send({ message: 'Server error' });
      }
    });

    // --- REVIEWS ---

    // GET reviews for a property by propertyId
    app.get('/reviews', async (req, res) => {
      try {
        const propertyId = req.query.propertyId;
        if (!propertyId) {
          return res.status(400).send({ message: 'propertyId is required' });
        }

        // If you store propertyId as string in reviews collection:
        const reviews = await reviewsCollection
          .find({ propertyId })
          .sort({ createdAt: -1 })
          .toArray();

        res.send(reviews);
      } catch (error) {
        console.error('Error fetching reviews:', error);
        res.status(500).send({ message: 'Internal server error' });
      }
    });

    // POST add a new review (protected)
    app.post('/reviews', verifyJWT, async (req, res) => {
      try {
        const review = req.body;
        if (
          !review.propertyId ||
          !review.userEmail ||
          !review.comment ||
          !review.rating
        ) {
          return res.status(400).send({ message: 'Missing required fields' });
        }

        review.createdAt = new Date();

        const result = await reviewsCollection.insertOne(review);
        res.send(result);
      } catch (error) {
        console.error('Error adding review:', error);
        res.status(500).send({ message: 'Failed to add review' });
      }
    });

    app.get('/latest-reviews', async (req, res) => {
      const latestReviews = await reviewsCollection
        .find({})
        .sort({ createdAt: -1 })
        .limit(3)
        .toArray();
      res.send(latestReviews);
    });

    // --- OFFERS ---

    app.get('/offers', verifyJWT, async (req, res) => {
      try {
        const userEmail = req.query.userEmail;
        if (!userEmail) {
          return res.status(400).send({ message: 'userEmail is required' });
        }

        const offers = await offersCollection.find({ userEmail }).toArray();
        res.send(offers);
      } catch (error) {
        console.error('Error fetching offers:', error);
        res.status(500).send({ message: 'Internal server error' });
      }
    });
    // POST /offers
    app.post('/offers', verifyJWT, async (req, res) => {
      try {
        const {
          userEmail,
          propertyId,
          offerAmount,
          message,
          propertyTitle,
          agentEmail, // if available
        } = req.body;

        if (!userEmail || !propertyId || !offerAmount) {
          return res.status(400).send({ message: 'Missing required fields' });
        }

        const offerData = {
          userEmail,
          propertyId,
          offerAmount,
          message: message || '',
          propertyTitle,
          agentEmail: agentEmail || null,
          status: 'pending', // default status
          timestamp: new Date(),
        };

        const result = await offersCollection.insertOne(offerData);

        res.send({ success: true, insertedId: result.insertedId });
      } catch (error) {
        console.error('Error submitting offer:', error);
        res.status(500).send({ message: 'Internal server error' });
      }
    });

    // PATCH: Update offer status (accept or reject)
    app.patch('/offers/:id', verifyJWT, async (req, res) => {
      try {
        const offerId = req.params.id;
        const { status } = req.body; // expected: 'accepted' or 'rejected'

        if (!['accepted', 'rejected'].includes(status)) {
          return res.status(400).send({ message: 'Invalid status' });
        }

        const result = await offersCollection.updateOne(
          { _id: new ObjectId(offerId) },
          { $set: { status } }
        );

        res.send({ success: result.modifiedCount > 0 });
      } catch (error) {
        console.error('Error updating offer status:', error);
        res.status(500).send({ message: 'Internal server error' });
      }
    });

    // --- STRIPE PAYMENT ---

    app.post('/create-payment-intent', verifyJWT, async (req, res) => {
      const { amount } = req.body;
      if (!amount || amount < 1)
        return res.status(400).send({ error: 'Invalid amount' });

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(amount * 100),
          currency: 'usd',
          payment_method_types: ['card'],
        });
        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        console.error('Stripe error:', error);
        res.status(500).send({ error: 'Payment intent creation failed' });
      }
    });

    // Direct purchase endpoint

    console.log('✅ Server ready');
  } finally {
    // keep server running
  }
}

run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Welcome to Signature Elite API');
});

app.listen(port, () => {
  console.log(`🚀 Server listening on port ${port}`);
});
