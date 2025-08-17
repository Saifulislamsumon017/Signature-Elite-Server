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
app.use(
  cors({
    origin: ['http://localhost:5173', 'https://signature-elite.web.app'],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

// JWT middleware
const verifyJWT = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).send({ message: 'Unauthorized' });

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).send({ message: 'Forbidden' });
    req.user = decoded;
    console.log(decoded);
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
    const reportsCollection = db.collection('reports');

    const verifyAdmin = async (req, res, next) => {
      const email = req.user?.email;

      console.log(email);
      if (!email) {
        return res.status(403).send({ message: 'Forbidden' });
      }

      const user = await usersCollection.findOne({ email });

      if (user?.role !== 'admin') {
        return res
          .status(403)
          .send({ message: 'Access denied. Not an admin.' });
      }

      next();
    };
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

    // === Admin Statistics ===
    app.get('/admin-stats', verifyJWT, async (req, res) => {
      try {
        const totalUsers = await usersCollection.countDocuments();
        const totalAgents = await usersCollection.countDocuments({
          role: 'agent',
        });
        const totalProperties = await propertiesCollection.countDocuments();
        const totalReviews = await reviewsCollection.countDocuments();
        const soldProperties = await offersCollection.countDocuments({
          status: 'paid',
        });

        res.send({
          totalUsers,
          totalAgents,
          totalProperties,
          totalReviews,
          soldProperties,
        });
      } catch (err) {
        console.error('Admin stats error:', err);
        res.status(500).send({ message: 'Internal server error' });
      }
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

    // ---  GET All ADMIN---

    app.get('/admin/users', verifyJWT, verifyAdmin, async (req, res) => {
      const users = await usersCollection.find().toArray();
      res.send(users);
    });

    app.patch(
      '/admin/users/:id/role',
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;
        const { role } = req.body;
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role } }
        );
        res.send(result);
      }
    );

    // Mark user as fraud
    app.patch(
      '/admin/users/:id/fraud',
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;
        const { isFraud } = req.body; // true/false to mark fraud

        try {
          // Update the fraud status of the user
          const result = await usersCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { isFraud } }
          );

          // Check if user was found and updated
          if (result.matchedCount === 0) {
            return res.status(404).send({ message: 'User not found' });
          }

          // If user is marked as fraud, delete their properties from the all-properties view
          if (isFraud) {
            await propertiesCollection.deleteMany({
              agentEmail: (
                await usersCollection.findOne({ _id: new ObjectId(id) })
              ).email,
            });
          }

          res.send({
            message: `User fraud status updated to ${
              isFraud ? 'fraud' : 'not fraud'
            }`,
          });
        } catch (error) {
          console.error('Error marking user as fraud:', error);
          res.status(500).send({ message: 'Failed to update fraud status' });
        }
      }
    );

    // DELETE user
    app.delete('/admin/users/:id', verifyJWT, verifyAdmin, async (req, res) => {
      const result = await usersCollection.deleteOne({
        _id: new ObjectId(req.params.id),
      });
      res.send(result);
    });

    app.get('/admin/reviews', verifyJWT, verifyAdmin, async (req, res) => {
      const reviews = await reviewsCollection.find().toArray();
      res.send(reviews);
    });

    app.delete(
      '/admin/reviews/:id',
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const result = await reviewsCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      }
    );
    // ---ADMIN REPORTS PROPERTIES ---

    app.get('/admin/reports', verifyJWT, verifyAdmin, async (req, res) => {
      const reports = await reportsCollection
        .find({})
        .sort({ createdAt: -1 })
        .toArray();
      res.send(reports);
    });

    app.delete(
      '/admin/reported-property/:propertyId',
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        const propertyId = req.params.propertyId;

        const deleteProperty = await propertiesCollection.deleteOne({
          _id: new ObjectId(propertyId),
        });
        const deleteReports = await reportsCollection.deleteMany({
          propertyId,
        });

        res.send({
          success: deleteProperty.deletedCount > 0,
          message: 'Property and related reports deleted',
        });
      }
    );
    // --- PROPERTIES ---

    app.get('/all-properties', async (req, res) => {
      const { search = '', sort = '' } = req.query;

      // Query to find verified properties
      const query = {
        verificationStatus: 'verified',
      };

      // Search filter for location
      if (search) query.location = { $regex: search, $options: 'i' };

      // Sort option based on query parameter
      let sortOption = {};
      if (sort === 'asc') sortOption.minPrice = 1;
      if (sort === 'desc') sortOption.minPrice = -1;

      try {
        // Fetch users who are not marked as fraud
        const agents = await usersCollection
          .find({ role: 'agent', isFraud: { $ne: true } }) // exclude fraud agents
          .project({ email: 1 }) // only email field is required
          .toArray();

        // Get valid emails (agents who are not fraud)
        const validEmails = agents.map(agent => agent.email);
        console.log(validEmails);
        // Add a filter for properties added by valid agents only
        // query.agentEmail = { $in: validEmails };

        // Fetch properties from the collection that match the query
        const properties = await propertiesCollection
          .find(query)
          .sort(sortOption)
          .toArray();

        // Send properties as response
        res.send(properties);
      } catch (error) {
        console.error('Error fetching properties:', error);
        res.status(500).send({ message: 'Internal server error' });
      }
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

    app.delete('/properties/:id', verifyJWT, async (req, res) => {
      const id = req.params.id;
      try {
        const result = await propertiesCollection.deleteOne({
          _id: new ObjectId(id),
        });
        if (result.deletedCount === 1) {
          res.send({ success: true });
        } else {
          res.status(404).send({ error: 'Property not found' });
        }
      } catch (error) {
        res.status(500).send({ error: 'Failed to delete property.' });
      }
    });

    app.get(
      '/admin/advertise-list',
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        const properties = await propertiesCollection
          .find({ verificationStatus: 'verified', advertised: { $ne: true } })
          .toArray();
        res.send(properties);
      }
    );

    app.patch(
      '/admin/advertise/:id',
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const result = await db
          .collection('properties')
          .updateOne({ _id: new ObjectId(id) }, { $set: { advertised: true } });
        res.send(result);
      }
    );

    // --- AGENTS PROPERTY GET ---

    // ▶️ POST /properties - Add Property

    app.post('/properties', verifyJWT, async (req, res) => {
      const userEmail = req.user.email;

      try {
        // Fetch the agent by email to check if they are fraud
        const agent = await usersCollection.findOne({ email: userEmail });

        // Check if the agent exists and if they are marked as fraud
        if (!agent || agent.role !== 'agent' || agent.isFraud) {
          return res
            .status(403)
            .send({ message: 'Forbidden: Fraud agent cannot add properties' });
        }

        const property = req.body;

        // Ensure required fields are provided
        if (!property?.agentEmail || !property?.title) {
          return res.status(400).send({ message: 'Missing required fields' });
        }

        // Insert the property into the database
        const result = await propertiesCollection.insertOne(property);
        res.send(result);
      } catch (error) {
        console.error('Error adding property:', error);
        res.status(500).send({ message: 'Internal server error' });
      }
    });

    // PUT /properties/:id - Update Property
    app.put('/properties/:id', verifyJWT, async (req, res) => {
      const { id } = req.params;

      // ✅ Destructure allowed fields from request body
      const {
        title,
        location,
        image,
        minPrice,
        maxPrice,
        bedrooms,
        bathrooms,
        facilities,
      } = req.body;

      // ✅ Required field validation
      if (!title || !location) {
        return res
          .status(400)
          .send({ message: 'Title and Location are required.' });
      }

      try {
        // ✅ Prepare update document
        const updateDoc = {
          title,
          location,
          ...(image && { image }),
          minPrice: minPrice !== undefined ? Number(minPrice) : 0,
          maxPrice: maxPrice !== undefined ? Number(maxPrice) : 0,
          bedrooms: bedrooms !== undefined ? Number(bedrooms) : 0,
          bathrooms: bathrooms !== undefined ? Number(bathrooms) : 0,
          facilities: Array.isArray(facilities)
            ? facilities
            : typeof facilities === 'string'
            ? facilities.split(',').map(f => f.trim())
            : [],
          updatedAt: new Date(),
        };

        // ✅ Log for debugging
        console.log('Updating property with:', updateDoc);

        // ✅ Execute update
        const result = await propertiesCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateDoc }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: 'Property not found' });
        }

        res.send({ message: 'Property updated successfully', result });
      } catch (error) {
        console.error('Error updating property:', error);
        res.status(500).send({
          message: 'Failed to update property',
          error: error.message,
        });
      }
    });

    app.get('/properties/agent/:email', verifyJWT, async (req, res) => {
      const email = req.params.email;
      try {
        const properties = await propertiesCollection
          .find({ agentEmail: email })
          .toArray();
        res.send(properties);
      } catch (error) {
        res.status(500).send({ error: 'Failed to fetch properties.' });
      }
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
        agentEmail,
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
          agentEmail,
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

    app.get('/my-reviews', verifyJWT, async (req, res) => {
      const userEmail = req.query.userEmail;
      if (!userEmail) {
        return res.status(400).send({ message: 'userEmail is required' });
      }

      try {
        const result = await reviewsCollection
          .aggregate([
            { $match: { userEmail } },
            {
              $addFields: {
                propertyObjectId: { $toObjectId: '$propertyId' },
              },
            },
            {
              $lookup: {
                from: 'properties',
                localField: 'propertyObjectId',
                foreignField: '_id',
                as: 'propertyInfo',
              },
            },
            {
              $unwind: {
                path: '$propertyInfo',
                preserveNullAndEmptyArrays: true,
              },
            },
            { $sort: { createdAt: -1 } },
            {
              $project: {
                _id: 1,
                rating: 1,
                comment: 1,
                createdAt: 1,
                propertyId: 1,
                propertyTitle: '$propertyInfo.title',
              },
            },
          ])
          .toArray();

        res.send(result);
      } catch (error) {
        console.error('Error fetching reviews:', error);
        res.status(500).send({ message: 'Internal server error' });
      }
    });

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

    // app.get('/reviews', async (req, res) => {
    //   const userEmail = req.query.email;

    //   if (!userEmail) {
    //     return res.status(400).send({ message: 'Email query is required' });
    //   }

    //   try {
    //     const reviews = await reviewsCollection
    //       .find({ userEmail })
    //       .sort({ createdAt: -1 }) // Optional: latest first
    //       .toArray();

    //     res.send(reviews);
    //   } catch (err) {
    //     res
    //       .status(500)
    //       .send({ message: 'Failed to fetch reviews', error: err });
    //   }
    // });

    // POST add a new review (protected)
    app.post('/reviews', verifyJWT, async (req, res) => {
      try {
        const review = req.body;

        // ✅ Add propertyTitle check
        if (
          !review.propertyId ||
          !review.propertyTitle || // ✅ Add this line
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

    app.delete('/reviews/:id', async (req, res) => {
      const reviewId = req.params.id;

      try {
        const result = await reviewsCollection.deleteOne({
          _id: new ObjectId(reviewId),
        });

        if (result.deletedCount === 0) {
          return res.status(404).send({ message: 'Review not found' });
        }

        res.send({ success: true, message: 'Review deleted' });
      } catch (err) {
        res
          .status(500)
          .send({ message: 'Failed to delete review', error: err });
      }
    });

    // --- OFFERS ---
    app.get('/offers', verifyJWT, async (req, res) => {
      try {
        const { userEmail } = req.query;
        if (!userEmail) {
          return res.status(400).send({ error: 'userEmail query required' });
        }

        const result = await offersCollection
          .find({ buyerEmail: userEmail })
          .sort({ createdAt: -1 })
          .toArray();

        res.send(result);
      } catch (error) {
        console.error('Error fetching offers:', error);
        res.status(500).send({ error: 'Internal server error' });
      }
    });

    app.get('/offers/:id', async (req, res) => {
      const id = req.params.id;
      try {
        const result = await offersCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!result) {
          return res.status(404).send({ message: 'Offer not found' });
        }
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: 'Server error' });
      }
    });

    // POST /offers

    app.post('/offers', verifyJWT, async (req, res) => {
      try {
        const {
          propertyId,
          propertyImage,
          propertyTitle,
          propertyLocation,
          agentName,
          agentEmail,
          buyerName,
          buyerEmail,
          offerAmount,
          offerStatus,
          isPaid,
          offerDate,
        } = req.body;

        console.log('Incoming Offer:', {
          propertyId,
          propertyImage,
          buyerEmail,
          offerAmount,
        });

        // Basic field validation
        if (!propertyId || !propertyImage || !buyerEmail || !offerAmount) {
          return res.status(400).send({ message: 'Missing required fields' });
        }

        const offerData = {
          propertyId,
          propertyImage,
          propertyTitle,
          propertyLocation,
          agentName,
          agentEmail,
          buyerName,
          buyerEmail,
          offerAmount,
          offerStatus: offerStatus || 'pending',
          isPaid: isPaid || false,
          offerDate: offerDate || new Date().toISOString(),
          timestamp: new Date(),
        };

        const result = await offersCollection.insertOne(offerData);

        if (result.insertedId) {
          res.send({ success: true, insertedId: result.insertedId });
        } else {
          res.status(500).send({ success: false, message: 'Insert failed' });
        }
      } catch (error) {
        console.error('Error submitting offer:', error);
        res.status(500).send({ message: 'Internal server error' });
      }
    });

    // PATCH: Update offer status (accept or reject)
    app.patch('/offers/:id', verifyJWT, async (req, res) => {
      const id = req.params.id;
      const { status, transactionId } = req.body;

      try {
        const targetOffer = await offersCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!targetOffer)
          return res.status(404).send({ error: 'Offer not found' });

        if (status === 'accepted') {
          // Accept this offer
          await offersCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { status } }
          );

          // Reject others for the same property
          await offersCollection.updateMany(
            {
              _id: { $ne: new ObjectId(id) },
              propertyId: targetOffer.propertyId,
              status: 'pending',
            },
            { $set: { status: 'rejected' } }
          );

          return res.send({ success: true });
        }

        // For payment update (from checkout)
        if (status === 'paid') {
          await offersCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { status, transactionId } }
          );
          return res.send({ success: true });
        }

        // Otherwise: update status directly
        await offersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status } }
        );

        res.send({ success: true });
      } catch (error) {
        console.error('Error updating offer status:', error);
        res.status(500).send({ error: 'Internal server error' });
      }
    });

    // --- USERS PROPERTY-BOUGHT ---

    app.get('/bought-properties', verifyJWT, async (req, res) => {
      const email = req.query.email;
      if (!email) return res.status(400).send({ error: 'Email is required' });

      try {
        const query = { userEmail: email, status: 'paid' };
        const boughtOffers = await offersCollection.find(query).toArray();
        res.send(boughtOffers);
      } catch (error) {
        console.error('Error fetching bought properties:', error);
        res.status(500).send({ error: 'Internal server error' });
      }
    });

    // --- AGENTS SOLD PROPERTY ---

    // GET /agent/sold?email=agent@example.com
    app.get('/agent/sold', verifyJWT, async (req, res) => {
      const agentEmail = req.query.email;

      try {
        const soldOffers = await offersCollection
          .find({
            agentEmail,
            offerStatus: 'bought', // ✅ match this field instead of "status"
            isPaid: true, // ✅ ensure it's paid
          })
          .toArray();

        res.send(soldOffers);
      } catch (error) {
        console.error('Error fetching sold properties:', error);
        res.status(500).send({ error: 'Internal server error' });
      }
    });

    // --- AGENTS REQUEST PROPERTY PROPERTY ---

    app.get('/agent/offers', verifyJWT, async (req, res) => {
      try {
        const { agentEmail } = req.query;

        const result = await offersCollection
          .find({ agentEmail })
          .sort({ timestamp: -1 })
          .toArray();

        res.send(result);
      } catch (error) {
        console.error('Error fetching agent offers:', error);
        res.status(500).send({ message: 'Internal server error' });
      }
    });

    app.patch('/agent/offers/:id', verifyJWT, async (req, res) => {
      try {
        const { id } = req.params;
        const { status, propertyId } = req.body;

        if (!['accepted', 'rejected'].includes(status)) {
          return res.status(400).send({ message: 'Invalid status' });
        }

        // Accept the current offer
        const updateResult = await offersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { offerStatus: status } }
        );

        // If accepted, reject all other offers for same property
        if (status === 'accepted') {
          await offersCollection.updateMany(
            {
              _id: { $ne: new ObjectId(id) },
              propertyId: propertyId,
            },
            { $set: { offerStatus: 'rejected' } }
          );
        }

        res.send(updateResult);
      } catch (error) {
        console.error('Error updating offer status:', error);
        res.status(500).send({ message: 'Internal server error' });
      }
    });

    app.get('/requested-properties', verifyJWT, async (req, res) => {
      const email = req.query.email;
      if (!email)
        return res.status(400).send({ error: 'Agent email required' });

      try {
        const agentProperties = await propertiesCollection
          .find({ agentEmail: email })
          .toArray();

        const propertyIds = agentProperties.map(p => p._id);

        const offers = await offersCollection
          .find({ propertyId: { $in: propertyIds }, status: 'pending' })
          .toArray();

        res.send(offers);
      } catch (error) {
        console.error('Error fetching requested properties:', error);
        res.status(500).send({ error: 'Internal server error' });
      }
    });

    // GET ALL PROPERTIES (FOR ADMIN VIEW )
    app.get('/admin/properties', verifyJWT, verifyAdmin, async (req, res) => {
      try {
        const result = await db.collection('properties').find().toArray();
        res.send(result);
      } catch (err) {
        res.status(500).send({ error: 'Failed to fetch properties' });
      }
    });

    // PATCH: UPDATE VERIFICATION STATUS (FOR ADMIN)
    app.patch(
      '/admin/properties/:id/status',
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;
        const { status } = req.body; // "verified" or "rejected"
        try {
          const result = await db
            .collection('properties')
            .updateOne(
              { _id: new ObjectId(id) },
              { $set: { verificationStatus: status } }
            );

          res.send(result);
        } catch (err) {
          res.status(500).send({ error: 'Failed to update status' });
        }
      }
    );

    // --- STRIPE PAYMENT ---

    app.post('/create-payment-intent', verifyJWT, async (req, res) => {
      try {
        const { amount } = req.body;

        if (!amount || typeof amount !== 'number') {
          return res.status(400).send({ message: 'Invalid amount' });
        }

        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(amount * 100), // Convert to cents
          currency: 'usd',
          payment_method_types: ['card'],
        });

        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        console.error('Payment Intent Error:', error);
        res.status(500).send({ message: 'Internal Server Error' });
      }
    });

    app.patch('/offers/pay/:id', verifyJWT, async (req, res) => {
      try {
        const { id } = req.params;
        const { transactionId } = req.body;

        if (!transactionId) {
          return res.status(400).send({ message: 'Transaction ID required' });
        }

        const result = await offersCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              offerStatus: 'bought',
              isPaid: true,
              transactionId,
            },
          }
        );

        res.send(result);
      } catch (error) {
        console.error('Payment update error:', error);
        res.status(500).send({ message: 'Internal Server Error' });
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
