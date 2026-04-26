import "@testing-library/jest-dom";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./test/mocks/server";

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
