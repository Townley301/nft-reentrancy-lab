import assert from "node:assert/strict";
import test from "node:test";
import {
  loadAdapterRegistry,
  validateAdapterParameters,
  validateAdapterSpec,
} from "../scripts/lib/adapter-spec.mjs";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("loads three development adapters and one independent holdout adapter", () => {
  const adapters = [...loadAdapterRegistry().values()];

  assert.equal(adapters.filter((adapter) => adapter.dataset === "development").length, 3);
  assert.equal(adapters.filter((adapter) => adapter.dataset === "holdout").length, 1);
  assert.equal(adapters.find((adapter) => adapter.dataset === "holdout")?.id, "marketplace-bond");
});

test("rejects executable fields and references outside declared deployments", () => {
  const base = clone(loadAdapterRegistry().get("marketplace-bond"));
  base.script = "arbitrary();";
  assert.throws(() => validateAdapterSpec(base), /script is forbidden/);

  const unknownTarget = clone(loadAdapterRegistry().get("marketplace-bond"));
  unknownTarget.entry.target = "unknown-contract";
  assert.throws(() => validateAdapterSpec(unknownTarget), /unknown deployment/);
});

test("enforces the parameter names and bounds declared by each adapter", () => {
  const adapter = loadAdapterRegistry().get("marketplace-bond");

  assert.doesNotThrow(() =>
    validateAdapterParameters(adapter, [{ tokenId: 2, bondAmount: 5 }], "parameters"),
  );
  assert.throws(
    () => validateAdapterParameters(adapter, [{ tokenId: 2, bondAmount: 11 }], "parameters"),
    /bondAmount must be an integer from 1 to 10/,
  );
  assert.throws(
    () => validateAdapterParameters(adapter, [{ tokenId: 2 }], "parameters"),
    /parameters do not match adapter bounds/,
  );
});
