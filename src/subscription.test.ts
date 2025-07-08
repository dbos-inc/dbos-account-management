// import { createTestingRuntime, TestingRuntime } from "@dbos-inc/dbos-sdk";
// import { CloudSubscription } from "./endpoints";
// import { Utils } from "./subscription";
// import request from "supertest";

// describe("cors-tests", () => {
//   let testRuntime: TestingRuntime;
//   const auth0TestID = "testauth0123";
//   const stripeTestID = "teststripe123";
//   const testEmail = "testemail@dbos.dev";

//   beforeAll(async () => {
//     testRuntime = await createTestingRuntime([CloudSubscription, Utils]);
//     await testRuntime.queryUserDB(`DELETE FROM accounts WHERE auth0_subject_id='${auth0TestID}';`);
//   });

//   afterAll(async () => {
//     await testRuntime.destroy();
//   });

//   test("account-management", async () => {
//     // Check our transactions are correct
//     await expect(testRuntime.invoke(Utils).recordStripeCustomer(auth0TestID, stripeTestID, testEmail)).resolves.toBeFalsy(); // No error
//     await expect(testRuntime.invoke(Utils).findStripeCustomerID(auth0TestID)).resolves.toBe(stripeTestID);
//     await expect(testRuntime.invoke(Utils).findAuth0UserID(stripeTestID)).resolves.toBe(auth0TestID);
//     await expect(testRuntime.invoke(Utils).findAuth0UserID("nonexistent")).rejects.toThrow("Cannot find auth0 user for stripe customer nonexistent"); // Non existent user
//   });

//   test("subscribe-cors", async () => {
//     // Check the prefligth request has the correct CORS headers
//     const resp = await request(testRuntime.getHandlersCallback())
//       .options("/subscribe")
//       .set("Origin", "https://dbos.dev")
//       .set("Access-Control-Request-Method", "POST")
//       .set("Authorization", "Bearer testtoken");
//     expect(resp.status).toBe(204);
//     expect(resp.headers["access-control-allow-origin"]).toBe("https://dbos.dev");
//     expect(resp.headers["access-control-allow-credentials"]).toBe("true");

//     // Our staging env.
//     const resp2 = await request(testRuntime.getHandlersCallback())
//       .options("/subscribe")
//       .set("Origin", "https://dbos.webflow.io")
//       .set("Access-Control-Request-Method", "POST")
//       .set("Authorization", "Bearer testtoken");
//     expect(resp2.status).toBe(204);
//     expect(resp2.headers["access-control-allow-origin"]).toBe("https://dbos.webflow.io");
//     expect(resp2.headers["access-control-allow-credentials"]).toBe("true");

//     // Cloud console
//     const resp3 = await request(testRuntime.getHandlersCallback())
//       .options("/subscribe")
//       .set("Origin", "https://console.dbos.dev")
//       .set("Access-Control-Request-Method", "POST")
//       .set("Authorization", "Bearer testtoken");
//     expect(resp3.status).toBe(204);
//     expect(resp3.headers["access-control-allow-origin"]).toBe("https://console.dbos.dev");
//     expect(resp3.headers["access-control-allow-credentials"]).toBe("true");

//     const resp4 = await request(testRuntime.getHandlersCallback())
//       .options("/subscribe")
//       .set("Origin", "https://staging.console.dbos.dev")
//       .set("Access-Control-Request-Method", "POST")
//       .set("Authorization", "Bearer testtoken");
//     expect(resp4.status).toBe(204);
//     expect(resp4.headers["access-control-allow-origin"]).toBe("https://staging.console.dbos.dev");
//     expect(resp4.headers["access-control-allow-credentials"]).toBe("true");
//   });

//   // Test retrieve cloud credentials
//   test("cloud-credential", async () => {
//     if (!process.env.DBOS_LOGIN_REFRESH_TOKEN || process.env.DBOS_LOGIN_REFRESH_TOKEN == "null") {
//       console.log("Skipping cloud-credentials test, no refresh token provided");
//       return;
//     }
//     await expect(Utils.retrieveAccessToken()).resolves.toBeTruthy();
//     process.env["DBOS_LOGIN_REFRESH_TOKEN"] = "faketoken";
//     await expect(Utils.retrieveAccessToken()).rejects.toThrow();
//   });

// });