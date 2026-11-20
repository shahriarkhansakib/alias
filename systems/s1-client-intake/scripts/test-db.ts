import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import mongoose from "mongoose";

async function main() {
  const rawUri = process.env.MONGODB_URI;
  const uri = rawUri || "mongodb://127.0.0.1:27017/ai_marketing_agency";

  const opts = {
    bufferCommands: false,
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
  };

  console.log("=== DB Connection Test ===");
  console.log("MONGODB_URI env set:", Boolean(rawUri));

  try {
    console.log("Attempting mongoose.connect (standard)...");
    await mongoose.connect(uri, opts);
    console.log("mongoose.connection.readyState:", mongoose.connection.readyState);

    const db = mongoose.connection.db;
    if (!db) {
      throw new Error("mongoose.connection.db is undefined");
    }

    const testCollection = db.collection("_db_test");
    const testDoc = {
      testField: "standard_connection_verification",
      timestamp: new Date().toISOString(),
    };

    console.log("Inserting test document...");
    const insertResult = await testCollection.insertOne(testDoc);
    console.log("Inserted ID:", insertResult.insertedId.toString());

    console.log("Reading back document by ID...");
    const retrievedDoc = await testCollection.findOne({ _id: insertResult.insertedId });
    console.log("Retrieved document:", JSON.stringify(retrievedDoc, null, 2));

    console.log("Cleaning up test document...");
    await testCollection.deleteOne({ _id: insertResult.insertedId });
    console.log("Cleanup complete.");

    await mongoose.disconnect();
    console.log("Disconnected successfully. Test SUCCESSFUL.");
  } catch (error: any) {
    console.error("Database Test FAILED with error:");
    console.error("Name:", error.name);
    console.error("Message:", error.message);
    if (error.code) console.error("Code:", error.code);
    process.exit(1);
  }
}

main();
