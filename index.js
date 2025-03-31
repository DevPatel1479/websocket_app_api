const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const bodyParser = require('body-parser');
const expressWs = require('express-ws');

const app = express();
expressWs(app);
app.use(cors());
app.use(bodyParser.json());

// Initialize Firebase Admin
// const serviceAccount = require('./serviceAccountKey.json');
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = admin.firestore();

// POST endpoint for jobs
app.post('/api/jobs', async (req, res) => {
    try {
      const jobData = req.body;
      
      const milestone_data = jobData["milestones"];
      console.log(jobData);
      // Validate required fields
      if (!jobData.job_title || !jobData.description || !jobData.job_category) {
        return res.status(400).json({ error: 'Missing required fields' });
      }
  
      // Convert dates to Firestore Timestamps
      const processedData = {
        ...jobData,
        posted_date: admin.firestore.Timestamp.fromDate(new Date(jobData.posted_date)),
        
        
        milestones: milestone_data ? 
        jobData.milestones.map(milestone => ({
          ...milestone,
          start_date: admin.firestore.Timestamp.fromDate(new Date(milestone.start_date)),
          end_date: admin.firestore.Timestamp.fromDate(new Date(milestone.end_date)),
        })) : null,
        status: 'pending'
      };
  
      // Create document reference and set data
      const jobRef = await db.collection('jobs').add(processedData);
  
      res.status(201).json({ 
        id: jobRef.id,
        message: 'Job created successfully with milestones in same collection'
      });
    } catch (error) {
      console.error('Error creating job:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });


  // WebSocket endpoint at /jobs
app.ws('/jobs', (ws, req) => {
  console.log('New client connected to /jobs');

  // Listen to real-time updates in the "jobs" collection
  const jobsRef = db.collection('jobs');
  const unsubscribe = jobsRef.onSnapshot(snapshot => {
    // Process each change in the snapshot
    snapshot.docChanges().forEach(change => {
      if (change.type === 'added') {
        // Send the added job data to the client as JSON
        ws.send(JSON.stringify({
          type: 'added',
          data: change.doc.data()
        }));
      }
      // Optionally handle "modified" or "removed" changes
      else if (change.type === 'modified') {
        ws.send(JSON.stringify({
          type: 'modified',
          data: change.doc.data()
        }));
      } else if (change.type === 'removed') {
        ws.send(JSON.stringify({
          type: 'removed',
          data: change.doc.data()
        }));
      }
    });
  }, err => {
    console.error('Error listening to jobs collection:', err);
    ws.send(JSON.stringify({ error: err.message }));
  });

  // Clean up the listener when the client disconnects
  ws.on('close', () => {
    console.log('Client disconnected from /jobs');
    unsubscribe();
  });
});



const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port http://localhost:${PORT}`);
});