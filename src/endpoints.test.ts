import { createTestingRuntime, TestingRuntime } from "@dbos-inc/dbos-sdk";
import { CloudSubscription, Utils } from "./endpoints";
import request from "supertest";

describe("cors-tests", () => {
  let testRuntime: TestingRuntime;
  const auth0TestID = "testauth0123";
  const stripeTestID = "teststripe123";
  const testEmail = "testemail@dbos.dev";

  beforeAll(async () => {
    testRuntime = await createTestingRuntime([CloudSubscription, Utils]);
    await testRuntime.queryUserDB(`DELETE FROM accounts WHERE auth0_subject_id='${auth0TestID}';`);
  });

  afterAll(async () => {
    await testRuntime.destroy();
  });

  test("account-management", async () => {
    // Check our transactions are correct
    await expect(testRuntime.invoke(Utils).recordStripeCustomer(auth0TestID, stripeTestID, testEmail)).resolves.toBeFalsy(); // No error
    await expect(testRuntime.invoke(Utils).findStripeCustomerID(auth0TestID)).resolves.toBe(stripeTestID);
    await expect(testRuntime.invoke(Utils).findAuth0UserID(stripeTestID)).resolves.toBe(auth0TestID);
    await expect(testRuntime.invoke(Utils).findAuth0UserID("nonexistent")).rejects.toThrow("Cannot find auth0 user for stripe customer nonexistent"); // Non existent user
  });

  test("subscribe-cors", async () => {
    // Check the prefligth request has the correct CORS headers
    const resp = await request(testRuntime.getHandlersCallback())
      .options("/subscribe")
      .set("Origin", "https://dbos.dev")
      .set("Access-Control-Request-Method", "POST")
      .set("Authorization", "Bearer testtoken");
    expect(resp.status).toBe(204);
    expect(resp.headers["access-control-allow-origin"]).toBe("https://dbos.dev");
    expect(resp.headers["access-control-allow-credentials"]).toBe("true");

    // Our staging env.
    const resp2 = await request(testRuntime.getHandlersCallback())
      .options("/subscribe")
      .set("Origin", "https://dbos.webflow.io")
      .set("Access-Control-Request-Method", "POST")
      .set("Authorization", "Bearer testtoken");
    expect(resp2.status).toBe(204);
    expect(resp2.headers["access-control-allow-origin"]).toBe("https://dbos.webflow.io");
    expect(resp2.headers["access-control-allow-credentials"]).toBe("true");
  });

  // Test retrieve cloud credentials
  test("cloud-credential", async () => {
    if (!process.env.DBOS_DEPLOY_REFRESH_TOKEN) {
      console.log("Skipping cloud-credentials test, no refresh token provided");
      return;
    }
    await expect(testRuntime.invoke(Utils).retrieveCloudCredential()).resolves.toBeTruthy();
    process.env["DBOS_DEPLOY_REFRESH_TOKEN"] = "faketoken";
    await expect(testRuntime.invoke(Utils).retrieveCloudCredential()).rejects.toThrow();
  });

});