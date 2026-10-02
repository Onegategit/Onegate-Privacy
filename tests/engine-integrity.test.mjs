import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
const require = createRequire(import.meta.url);
const root = resolve(dirname(require.resolve("privacycash-evm")), "..");
const hashes = {
  "circuits/transaction2.wasm":
    "a277631b7616c2c0bfd78a1648b069972ac6020e5509ae8f9bfc8772bdc70ec1",
  "circuits/transaction2.zkey":
    "4aa7aa5c1c28ed1f00fee84f49c1686f53210fd999ef7c8db6cfcd298af4e693",
  "dist/utils/networkConfig.js":
    "ab025ed3bea36e38c1dfd9d8b0343d8890e9fa234c2ed55dbbc75f4a870dd53c",
};
test("pinned SDK and original proving artifacts retain exact hashes", () => {
  assert.equal(
    JSON.parse(readFileSync(resolve(root, "package.json"))).version,
    "1.3.3",
  );
  for (const [file, hash] of Object.entries(hashes)) {
    assert.equal(
      createHash("sha256")
        .update(readFileSync(resolve(root, file)))
        .digest("hex"),
      hash,
      file,
    );
    if (file.startsWith("circuits/") && existsSync("dist/" + file))
      assert.equal(
        createHash("sha256")
          .update(readFileSync("dist/" + file))
          .digest("hex"),
        hash,
        "deployed " + file,
      );
  }
});
