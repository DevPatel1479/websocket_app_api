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
  // databaseURL : "https://newtestproject-f7d42-default-rtdb.firebaseio.com/"
});

const db = admin.firestore();


// WebSocket connection handler


// WebSocket endpoint at /jobs
app.ws('/get/jobs', async (ws, req) => {
  console.log('New client connected to /jobs');
  
  const jobsRef = db.collection('jobs');

  try {

    // 🔥 Send the initial full job list
    const snapshot = await jobsRef.get();
    const initialJobs = [];

    snapshot.forEach(doc => {
      let jobData = doc.data();

      // Convert Firestore Timestamps to ISO strings
      if (jobData.posted_date && jobData.posted_date.toDate) {
        jobData.posted_date = jobData.posted_date.toDate().toISOString();
      }

      if (Array.isArray(jobData.milestones)) {
        jobData.milestones = jobData.milestones.map(milestone => ({
          ...milestone,
          start_date: milestone.start_date?.toDate?.().toISOString() || milestone.start_date,
          end_date: milestone.end_date?.toDate?.().toISOString() || milestone.end_date,
        }));
      }

      initialJobs.push(jobData);
    });

    ws.send(JSON.stringify({
      type: 'initial',
      data: initialJobs
    }));
  } catch (err) {
    console.error('Error fetching initial jobs:', err);
    ws.send(JSON.stringify({ error: err.message }));
  }

  // ✅ Then listen for real-time changes
  const unsubscribe = jobsRef.onSnapshot(snapshot => {
    snapshot.docChanges().forEach(change => {
      let jobData = change.doc.data();

      if (jobData.posted_date && jobData.posted_date.toDate) {
        jobData.posted_date = jobData.posted_date.toDate().toISOString();
      }

      if (Array.isArray(jobData.milestones)) {
        jobData.milestones = jobData.milestones.map(milestone => ({
          ...milestone,
          start_date: milestone.start_date?.toDate?.().toISOString() || milestone.start_date,
          end_date: milestone.end_date?.toDate?.().toISOString() || milestone.end_date,
        }));
      }

      // Real-time change handling
      if (change.type === 'added') {
        ws.send(JSON.stringify({ type: 'added', data: jobData }));
      } else if (change.type === 'modified') {
        ws.send(JSON.stringify({ type: 'modified', data: jobData }));
      } else if (change.type === 'removed') {
        ws.send(JSON.stringify({ type: 'removed', data: jobData }));
      }
    });
  }, err => {
    console.error('Error listening to jobs collection:', err);
    ws.send(JSON.stringify({ error: err.message }));
  });

  // ✅ Cleanup when socket is closed
  ws.on('close', () => {
    console.log('Client disconnected from /jobs');
    unsubscribe();
  });
  ws.on('message', async (message) => {
    try {
      const msg = JSON.parse(message);
      if (msg.type === 'edit_job') {
        const { job_id, updates } = msg;
  
        const jobRef = db.collection('jobs').doc(job_id);
        const doc = await jobRef.get();
  
        if (!doc.exists) {
          ws.send(JSON.stringify({ error: 'Job not found' }));
          return;
        }
  
        // Only update allowed fields
        const allowedFields = ['job_title', 'description', 'budget','required_skills'];
        const filteredUpdates = {};
  
        for (const key of allowedFields) {
          if (updates[key] !== undefined) {
            filteredUpdates[key] = updates[key];
          }
        }
        if (updates.required_skills !== undefined) {
          const skills = updates.required_skills;
          if (Array.isArray(skills)) {
              filteredUpdates.required_skills = skills; // Directly use the array if provided
          } else if (typeof skills === 'string') {
              filteredUpdates.required_skills = skills.split(',').map(skill => skill.trim());  // Handle comma-separated string
          }
      }
        await jobRef.update(filteredUpdates);
        console.log(`🔄 Job ${job_id} updated with`, filteredUpdates);
      }   else if (msg.type === 'delete_job') {
        const { job_id } = msg;
        const jobRef = db.collection('jobs').doc(job_id);
        const doc = await jobRef.get();
        if (!doc.exists) {
          ws.send(JSON.stringify({ error: 'Job not found' }));
          return;
        }
        await jobRef.delete();
        console.log(`🗑️ Job ${job_id} deleted`);
        // Firestore onSnapshot will automatically emit a 'removed' change
      }
  
    } catch (err) {
      console.error('Edit message error:', err.message);
      ws.send(JSON.stringify({ error: 'Invalid edit format or error occurred' }));
    }
  });
  

});

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
      await jobRef.update({ job_id: jobRef.id });
      res.status(201).json({ 
        id: jobRef.id,
        message: 'Job created successfully with milestones in same collection'
      });
    } catch (error) {
      console.error('Error creating job:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

app.get('/api/client/profile/:id', async (req, res)=>{
  const uid = req.params.id;
  
  if (!uid ){
    const msg = {
      "message" : "Client Id required!!"
    }
    return res.status(400).json(msg);

  }
    
  try{
    const docRef = db.collection('users').doc(uid);
    const docSnap = await docRef.get();
    console.log(docSnap.exists);
    if (!docSnap.exists){
      
      return res.status(404).json({ message: "Client not found!" });
    }else{
      
      const clientData = docSnap.data();
      delete clientData.password;
      delete clientData.createdAt;
      return res.status(200).json({
        success: true,
        data: clientData
      });
    }
  
  }catch(error){
    console.error('Error fetching client data:', error);
    return res.status(500).json({ error: 'Internal server error' });
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
      let jobData = change.doc.data();
      if (jobData.posted_date && jobData.posted_date.toDate) {
        jobData.posted_date = jobData.posted_date.toDate().toISOString();
      }
      if (Array.isArray(jobData.milestones)) {
        jobData.milestones = jobData.milestones.map(milestone => {
          return {
            ...milestone,
            start_date: milestone.start_date?.toDate?.().toISOString() || milestone.start_date,
            end_date: milestone.end_date?.toDate?.().toISOString() || milestone.end_date,
          };
        });
      }
      if (change.type === 'added') {
        // Send the added job data to the client as JSON
        ws.send(JSON.stringify({
          type: 'added',
          data: jobData
        }));
      }
      // Optionally handle "modified" or "removed" changes
      else if (change.type === 'modified') {
        ws.send(JSON.stringify({
          type: 'modified',
          data: jobData
        }));
      } else if (change.type === 'removed') {
        ws.send(JSON.stringify({
          type: 'removed',
          data: jobData
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