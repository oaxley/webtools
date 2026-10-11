/**
 * Tests for the X.509 decoder (../src/x509.ts).
 *
 * Fixtures were generated with OpenSSL. They aren't production
 * certificates — just structurally valid X.509 blobs that cover the
 * features the decoder cares about.
 *
 *   openssl req -x509 -newkey rsa:2048 -nodes -subj '/CN=example.com/O=Example Corp/C=US' \
 *       -addext 'subjectAltName=DNS:example.com,DNS:www.example.com,IP:192.0.2.1' \
 *       -addext 'keyUsage=digitalSignature,keyEncipherment' \
 *       -addext 'extendedKeyUsage=serverAuth,clientAuth' ...
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    computeFingerprints,
    customX509Extensions,
    decodeX509,
    hasX509Field,
    KNOWN_X509_FIELDS,
    type X509Extension,
} from "../src/x509.ts";

// --- Fixtures ---------------------------------------------------------------

const RSA_CERT = `
-----BEGIN CERTIFICATE-----
MIIDsjCCApqgAwIBAgIUYvGZlAsjO7p8fNMZzOW585nNmX0wDQYJKoZIhvcNAQEL
BQAwOjEUMBIGA1UEAwwLZXhhbXBsZS5jb20xFTATBgNVBAoMDEV4YW1wbGUgQ29y
cDELMAkGA1UEBhMCVVMwHhcNMjYxMDExMTgyODQ1WhcNMjcxMDExMTgyODQ1WjA6
MRQwEgYDVQQDDAtleGFtcGxlLmNvbTEVMBMGA1UECgwMRXhhbXBsZSBDb3JwMQsw
CQYDVQQGEwJVUzCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAKNKu+wt
47MLEHUeG3VA4rodFvqH1SwBhbM4ALeauo96RhjMznFCOBEHlg3/Bvd/bnr7Xj6b
Rt0yRER0cPRnEN812keLFKHElaYtK35XYsvfcNu9OSVAvxduojcSmYe7xaGciUhW
8DZOHVw+nHvz/GqW9fWEwjaKmZjUKzCNUPUFV5v+rPCpqEDROn2dskMzJdv2sikI
apvLFhvSr6woVcJhIHMcP1Vn7pXwWi9WrHZoC4x5EGAwnUM4tSgyffQNj0P+Mw0r
UfYiEZwofkGma9MDobN+m9WFbstHx0GCqyy9++p/NLYIFeeZaPq6DehrHWnjzRNa
paWiEuVS8vIev20CAwEAAaOBrzCBrDAdBgNVHQ4EFgQU+++bkD1blLzJcZ/CAtv1
zyw1PecwHwYDVR0jBBgwFoAU+++bkD1blLzJcZ/CAtv1zyw1PecwDwYDVR0TAQH/
BAUwAwEB/zAtBgNVHREEJjAkggtleGFtcGxlLmNvbYIPd3d3LmV4YW1wbGUuY29t
hwTAAAIBMAsGA1UdDwQEAwIFoDAdBgNVHSUEFjAUBggrBgEFBQcDAQYIKwYBBQUH
AwIwDQYJKoZIhvcNAQELBQADggEBAAiNR0fpJOy0P+x81M6j9Doh+kPTd2a4gcgf
FsV2zDI1OF0FrafxDrfVYv40EhIjrmwb4/nx3AScLKXHAT8dQrVJ4tFUwgorjnmO
lEIXSJQZiTmOF/0nhB447fYQOxo6pF3p9qTjvKLH9vUjW5gCiIyGQ1VDuFjeUBAQ
6stSg5XhTEJcd5TCHiSWFCTonQ/P3z6I749qawkTu4ZC7xncnGeC1hBWhuLcyLdx
kastBAuYN+jcZ0R5LF5X481SMcDDUi39SB9QZoILRv31v7rv2106uSXgq80VZFcV
poGMwYaA4WkHLzA332Dry4dSRfmyGF2p3nrnBM26mZSRv/k6l3U=
-----END CERTIFICATE-----
`.trim();

const EC_CERT = `
-----BEGIN CERTIFICATE-----
MIIBiDCCAS2gAwIBAgIURGKn8UW0RLPxg17np4OswD7m+oMwCgYIKoZIzj0EAwIw
GTEXMBUGA1UEAwwOZWMuZXhhbXBsZS5jb20wHhcNMjYxMDExMTgyODQ1WhcNMjcx
MDExMTgyODQ1WjAZMRcwFQYDVQQDDA5lYy5leGFtcGxlLmNvbTBZMBMGByqGSM49
AgEGCCqGSM49AwEHA0IABJz6eONjuKFmv2c57RbL3gh4kKWHeh91hGsDYn8hNsdV
6dM5L7Hp1TAvTp+xZ2XWVk43dqtBeHobBYJ1+hhLDamjUzBRMB0GA1UdDgQWBBSX
iuuokRaRtf8ztI8Io2d7q+1l1TAfBgNVHSMEGDAWgBSXiuuokRaRtf8ztI8Io2d7
q+1l1TAPBgNVHRMBAf8EBTADAQH/MAoGCCqGSM49BAMCA0kAMEYCIQCEyxiMzJ/L
JwIdWxmXFcj6G4e2wpNUEheyjOxLp2TjLwIhAOBsjHmscRc5LpNFVbPJMKCkfvTF
WqpCY7My7hcJTAvF
-----END CERTIFICATE-----
`.trim();

const CA_CERT = `
-----BEGIN CERTIFICATE-----
MIIDZjCCAk6gAwIBAgIUTE5mt0u+Qjf6TpCJsuSiAMUlKGwwDQYJKoZIhvcNAQEL
BQAwOTEYMBYGA1UEAwwPRXhhbXBsZSBSb290IENBMRAwDgYDVQQKDAdFeGFtcGxl
MQswCQYDVQQGEwJVUzAeFw0yNjEwMTExODI4NDVaFw0zNjEwMDgxODI4NDVaMDkx
GDAWBgNVBAMMD0V4YW1wbGUgUm9vdCBDQTEQMA4GA1UECgwHRXhhbXBsZTELMAkG
A1UEBhMCVVMwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDNTFDVi0+u
3uH//qpS+4UbblPxnnuADBt7WJoxsHPK9le9Iu1dSYuQ8Nn+awo+Oe3JkvAPfBQs
Uxf4G6PADjx0wIspLW45ST+n7Td+Vk194oDOLMygZpVNXQg9cbXxDLUdXBJJQvCx
5ReS1HJANGw5S3d+3QeEJtzLKaxi8ceKIsDoahgdEBC+/IAnlgrZ+XQePOtGzhyH
CU2Kv1sO99OSyklFMCkFLW89Lf1X0maS4FWRAQC9fCP7vrYIF/yJ5CgSYZqeKF33
s25nVv/W8wfg2qFmhf6GRsCc0FTLMi21YXKjYjq7GQZxxgsdJYaBm2ywQCBh4iM3
RO2hQh7hnBv3AgMBAAGjZjBkMB0GA1UdDgQWBBTJBqbOWs5Si0h9OcX175yX9YD5
kjAfBgNVHSMEGDAWgBTJBqbOWs5Si0h9OcX175yX9YD5kjASBgNVHRMBAf8ECDAG
AQH/AgEBMA4GA1UdDwEB/wQEAwIBBjANBgkqhkiG9w0BAQsFAAOCAQEAWqDq7Ekd
PeTbT6M45sjjjczYcayuAt+FFLSIeYNwx9g3UTCb0Rm2BTzzrvqnCtvt5fEaFBIr
ylSSqlT62RpzQc/EbnzQ6tKPBM4IlEYSnCiM4kseMd6CiE9Cdo54I2UERW6K+t9S
fPG8ouE/3/o8GtrMDI3URpkywc7N/Miq84czLY6/5qwWucSKxUGUhkcpcMVBAnvj
+lFUXuemCC7pa1o8yNeMVOw9ZxEVzrZ1hSkceDSx7qDngBLUlog+PJOUgbPgAu1y
LtGFRY6qnWPCEeYJHDfgw9JIjr9tgQiAS2rgoVCqcLZjX49s8Zqqx+MRBWeSM4NX
YevL+/+GhWB+6A==
-----END CERTIFICATE-----
`.trim();

// --- RSA cert ---------------------------------------------------------------

describe("decodeX509 - RSA 2048 server cert", () => {
    const cert = decodeX509(RSA_CERT);

    it("captures the mandatory TBS fields", () => {
        assert.equal(cert.version, 3);
        assert.ok(cert.serialNumber.length > 0);
        assert.equal(cert.signatureAlgorithm, "sha256WithRSAEncryption");
        assert.equal(
            cert.signatureAlgorithmOid,
            "1.2.840.113549.1.1.11",
        );
    });

    it("parses issuer and subject DNs", () => {
        assert.equal(
            cert.subject.dn,
            "CN=example.com, O=Example Corp, C=US",
        );
        assert.equal(cert.subject.rdns[0].type, "CN");
        assert.equal(cert.subject.rdns[0].value, "example.com");
        // Self-signed → issuer == subject here.
        assert.equal(cert.issuer.dn, cert.subject.dn);
    });

    it("parses validity dates", () => {
        assert.equal(
            cert.validity.notBefore.toISOString(),
            "2026-10-11T18:28:45.000Z",
        );
        assert.equal(
            cert.validity.notAfter.toISOString(),
            "2027-10-11T18:28:45.000Z",
        );
    });

    it("decodes the RSA public key with its modulus size", () => {
        assert.equal(cert.subjectPublicKey.algorithm, "RSA");
        assert.equal(cert.subjectPublicKey.sizeBits, 2048);
        assert.equal(cert.subjectPublicKey.curve, undefined);
        assert.ok(cert.subjectPublicKey.base64Der.length > 0);
    });

    it("extracts SubjectAltName with mixed DNS and IP entries", () => {
        const san = findExt(cert.extensions, "2.5.29.17");
        assert.equal(san.value.kind, "subjectAltName");
        if (san.value.kind !== "subjectAltName") return;
        assert.deepEqual(san.value.names, [
            { type: "DNS", value: "example.com" },
            { type: "DNS", value: "www.example.com" },
            { type: "IP", value: "192.0.2.1" },
        ]);
    });

    it("extracts KeyUsage bits", () => {
        const ku = findExt(cert.extensions, "2.5.29.15");
        assert.equal(ku.value.kind, "keyUsage");
        if (ku.value.kind !== "keyUsage") return;
        assert.deepEqual(ku.value.usages, [
            "digitalSignature",
            "keyEncipherment",
        ]);
    });

    it("extracts ExtKeyUsage names", () => {
        const eku = findExt(cert.extensions, "2.5.29.37");
        assert.equal(eku.value.kind, "extKeyUsage");
        if (eku.value.kind !== "extKeyUsage") return;
        assert.deepEqual(eku.value.usages, ["serverAuth", "clientAuth"]);
    });

    it("extracts SKI and AKI", () => {
        const ski = findExt(cert.extensions, "2.5.29.14");
        const aki = findExt(cert.extensions, "2.5.29.35");
        assert.equal(ski.value.kind, "subjectKeyIdentifier");
        assert.equal(aki.value.kind, "authorityKeyIdentifier");
        if (ski.value.kind !== "subjectKeyIdentifier") return;
        if (aki.value.kind !== "authorityKeyIdentifier") return;
        assert.ok(ski.value.keyId.length > 0);
        // Self-signed → AKI keyId should match SKI.
        assert.equal(aki.value.keyId, ski.value.keyId);
    });

    it("reports a non-empty signature value", () => {
        assert.ok(cert.signature.hex.length > 0);
        // 2048-bit RSA → 256 bytes → 256 hex pairs + 255 colons.
        assert.equal(cert.signature.hex.split(":").length, 256);
    });

    it("marks all mandatory TBS fields as present", () => {
        for (const spec of KNOWN_X509_FIELDS) {
            if (spec.location === "tbs") {
                assert.equal(
                    hasX509Field(cert, spec),
                    true,
                    `TBS field ${spec.key} should be present`,
                );
            }
        }
    });

    it("detects BasicConstraints as a known extension", () => {
        assert.ok(cert.extensions.some((e) => e.oid === "2.5.29.19"));
    });

    it("exposes no custom (unknown) extensions on this cert", () => {
        assert.deepEqual(customX509Extensions(cert), []);
    });

    it("computes fingerprints matching OpenSSL output", async () => {
        const { sha1, sha256 } = await computeFingerprints(cert);
        assert.equal(
            sha1.toUpperCase(),
            "55:40:E5:AB:C9:B8:E3:F4:18:89:35:B7:F7:76:78:3D:99:9F:23:10",
        );
        assert.equal(
            sha256.toUpperCase(),
            "E1:D4:0E:2A:A2:0C:61:AC:3B:D7:2A:C0:37:DF:5C:2A:F1:D7:89:55:6D:C4:21:2A:D9:AB:BC:A9:C4:80:62:DF",
        );
    });
});

// --- EC cert ----------------------------------------------------------------

describe("decodeX509 - EC P-256 cert", () => {
    const cert = decodeX509(EC_CERT);

    it("recognises the EC algorithm and curve", () => {
        assert.equal(cert.subjectPublicKey.algorithm, "EC");
        assert.equal(cert.subjectPublicKey.curve, "P-256");
        assert.equal(cert.subjectPublicKey.sizeBits, 256);
    });

    it("recognises the ECDSA signature algorithm", () => {
        assert.equal(cert.signatureAlgorithm, "ecdsa-with-SHA256");
    });

    it("parses the single-component subject", () => {
        assert.equal(cert.subject.dn, "CN=ec.example.com");
    });

    it("computes the SHA-256 fingerprint", async () => {
        const { sha256 } = await computeFingerprints(cert);
        assert.equal(
            sha256.toUpperCase(),
            "D3:3E:56:8D:07:BE:43:D5:6A:29:F9:E0:F0:71:CD:EC:20:EC:A7:6F:4E:FA:7B:6B:37:39:A3:16:98:A7:BC:6B",
        );
    });
});

// --- CA cert ----------------------------------------------------------------

describe("decodeX509 - self-signed CA cert", () => {
    const cert = decodeX509(CA_CERT);

    it("flags the certificate as a CA with a path length constraint", () => {
        const bc = findExt(cert.extensions, "2.5.29.19");
        assert.equal(bc.critical, true);
        assert.equal(bc.value.kind, "basicConstraints");
        if (bc.value.kind !== "basicConstraints") return;
        assert.equal(bc.value.ca, true);
        assert.equal(bc.value.pathLenConstraint, 1);
    });

    it("surfaces critical keyCertSign + cRLSign usages", () => {
        const ku = findExt(cert.extensions, "2.5.29.15");
        assert.equal(ku.critical, true);
        assert.equal(ku.value.kind, "keyUsage");
        if (ku.value.kind !== "keyUsage") return;
        assert.deepEqual(ku.value.usages, ["keyCertSign", "cRLSign"]);
    });

    it("has the expected SHA-256 fingerprint", async () => {
        const { sha256 } = await computeFingerprints(cert);
        assert.equal(
            sha256.toUpperCase(),
            "66:D5:57:17:EC:A0:52:70:3A:9C:D9:D8:AD:39:36:13:88:C4:E9:34:65:C8:03:E5:8E:75:66:D1:0E:F7:E4:2F",
        );
    });
});

// --- Input shapes -----------------------------------------------------------

describe("decodeX509 - input shapes", () => {
    it("accepts raw base64 DER without PEM headers", () => {
        const base64Only = RSA_CERT
            .replace(/-----BEGIN CERTIFICATE-----/, "")
            .replace(/-----END CERTIFICATE-----/, "")
            .replace(/\s+/g, "");
        const cert = decodeX509(base64Only);
        assert.equal(cert.version, 3);
        assert.equal(cert.pem, null);
    });

    it("preserves the original PEM text", () => {
        const cert = decodeX509(RSA_CERT);
        assert.equal(cert.pem, RSA_CERT);
    });

    it("rejects empty input", () => {
        assert.throws(() => decodeX509(""), /Empty input/);
    });

    it("rejects obvious non-certificate input", () => {
        // The exact message depends on how far the parser gets before
        // failing (bad base64 vs bad DER); either is a user-friendly error.
        assert.throws(() => decodeX509("not a certificate"));
    });

    it("rejects garbled base64", () => {
        assert.throws(
            () =>
                decodeX509(
                    "-----BEGIN CERTIFICATE-----\n!!!\n-----END CERTIFICATE-----",
                ),
            /base64/,
        );
    });
});

// --- Helpers ----------------------------------------------------------------

function findExt(exts: X509Extension[], oid: string): X509Extension {
    const found = exts.find((e) => e.oid === oid);
    assert.ok(found, `expected extension ${oid}`);
    return found!;
}
