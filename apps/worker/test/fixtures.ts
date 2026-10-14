/**
 * Shared certificate fixtures for the `/api/v1/x509` and `/mcp`
 * `decode_x509` specs, so both exercise the exact same inputs.
 */

// Shipped RSA sample from the X.509 decoder page. Self-signed, with
// SAN / KeyUsage / ExtKeyUsage / SKI / AKI / BasicConstraints. Valid
// 2026-10-11 → 2027-10-11.
export const SAMPLE_RSA = [
	"-----BEGIN CERTIFICATE-----",
	"MIIDsjCCApqgAwIBAgIUYvGZlAsjO7p8fNMZzOW585nNmX0wDQYJKoZIhvcNAQEL",
	"BQAwOjEUMBIGA1UEAwwLZXhhbXBsZS5jb20xFTATBgNVBAoMDEV4YW1wbGUgQ29y",
	"cDELMAkGA1UEBhMCVVMwHhcNMjYxMDExMTgyODQ1WhcNMjcxMDExMTgyODQ1WjA6",
	"MRQwEgYDVQQDDAtleGFtcGxlLmNvbTEVMBMGA1UECgwMRXhhbXBsZSBDb3JwMQsw",
	"CQYDVQQGEwJVUzCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAKNKu+wt",
	"47MLEHUeG3VA4rodFvqH1SwBhbM4ALeauo96RhjMznFCOBEHlg3/Bvd/bnr7Xj6b",
	"Rt0yRER0cPRnEN812keLFKHElaYtK35XYsvfcNu9OSVAvxduojcSmYe7xaGciUhW",
	"8DZOHVw+nHvz/GqW9fWEwjaKmZjUKzCNUPUFV5v+rPCpqEDROn2dskMzJdv2sikI",
	"apvLFhvSr6woVcJhIHMcP1Vn7pXwWi9WrHZoC4x5EGAwnUM4tSgyffQNj0P+Mw0r",
	"UfYiEZwofkGma9MDobN+m9WFbstHx0GCqyy9++p/NLYIFeeZaPq6DehrHWnjzRNa",
	"paWiEuVS8vIev20CAwEAAaOBrzCBrDAdBgNVHQ4EFgQU+++bkD1blLzJcZ/CAtv1",
	"zyw1PecwHwYDVR0jBBgwFoAU+++bkD1blLzJcZ/CAtv1zyw1PecwDwYDVR0TAQH/",
	"BAUwAwEB/zAtBgNVHREEJjAkggtleGFtcGxlLmNvbYIPd3d3LmV4YW1wbGUuY29t",
	"hwTAAAIBMAsGA1UdDwQEAwIFoDAdBgNVHSUEFjAUBggrBgEFBQcDAQYIKwYBBQUH",
	"AwIwDQYJKoZIhvcNAQELBQADggEBAAiNR0fpJOy0P+x81M6j9Doh+kPTd2a4gcgf",
	"FsV2zDI1OF0FrafxDrfVYv40EhIjrmwb4/nx3AScLKXHAT8dQrVJ4tFUwgorjnmO",
	"lEIXSJQZiTmOF/0nhB447fYQOxo6pF3p9qTjvKLH9vUjW5gCiIyGQ1VDuFjeUBAQ",
	"6stSg5XhTEJcd5TCHiSWFCTonQ/P3z6I749qawkTu4ZC7xncnGeC1hBWhuLcyLdx",
	"kastBAuYN+jcZ0R5LF5X481SMcDDUi39SB9QZoILRv31v7rv2106uSXgq80VZFcV",
	"poGMwYaA4WkHLzA332Dry4dSRfmyGF2p3nrnBM26mZSRv/k6l3U=",
	"-----END CERTIFICATE-----",
].join("\n");

// Shipped self-signed CA sample. Valid 2026-10-11 → 2036-10-08 — long
// enough that `analysis.state` is reliably "active" for the useful
// lifetime of this test fixture.
export const SAMPLE_CA = [
	"-----BEGIN CERTIFICATE-----",
	"MIIDZjCCAk6gAwIBAgIUTE5mt0u+Qjf6TpCJsuSiAMUlKGwwDQYJKoZIhvcNAQEL",
	"BQAwOTEYMBYGA1UEAwwPRXhhbXBsZSBSb290IENBMRAwDgYDVQQKDAdFeGFtcGxl",
	"MQswCQYDVQQGEwJVUzAeFw0yNjEwMTExODI4NDVaFw0zNjEwMDgxODI4NDVaMDkx",
	"GDAWBgNVBAMMD0V4YW1wbGUgUm9vdCBDQTEQMA4GA1UECgwHRXhhbXBsZTELMAkG",
	"A1UEBhMCVVMwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDNTFDVi0+u",
	"3uH//qpS+4UbblPxnnuADBt7WJoxsHPK9le9Iu1dSYuQ8Nn+awo+Oe3JkvAPfBQs",
	"Uxf4G6PADjx0wIspLW45ST+n7Td+Vk194oDOLMygZpVNXQg9cbXxDLUdXBJJQvCx",
	"5ReS1HJANGw5S3d+3QeEJtzLKaxi8ceKIsDoahgdEBC+/IAnlgrZ+XQePOtGzhyH",
	"CU2Kv1sO99OSyklFMCkFLW89Lf1X0maS4FWRAQC9fCP7vrYIF/yJ5CgSYZqeKF33",
	"s25nVv/W8wfg2qFmhf6GRsCc0FTLMi21YXKjYjq7GQZxxgsdJYaBm2ywQCBh4iM3",
	"RO2hQh7hnBv3AgMBAAGjZjBkMB0GA1UdDgQWBBTJBqbOWs5Si0h9OcX175yX9YD5",
	"kjAfBgNVHSMEGDAWgBTJBqbOWs5Si0h9OcX175yX9YD5kjASBgNVHRMBAf8ECDAG",
	"AQH/AgEBMA4GA1UdDwEB/wQEAwIBBjANBgkqhkiG9w0BAQsFAAOCAQEAWqDq7Ekd",
	"PeTbT6M45sjjjczYcayuAt+FFLSIeYNwx9g3UTCb0Rm2BTzzrvqnCtvt5fEaFBIr",
	"ylSSqlT62RpzQc/EbnzQ6tKPBM4IlEYSnCiM4kseMd6CiE9Cdo54I2UERW6K+t9S",
	"fPG8ouE/3/o8GtrMDI3URpkywc7N/Miq84czLY6/5qwWucSKxUGUhkcpcMVBAnvj",
	"+lFUXuemCC7pa1o8yNeMVOw9ZxEVzrZ1hSkceDSx7qDngBLUlog+PJOUgbPgAu1y",
	"LtGFRY6qnWPCEeYJHDfgw9JIjr9tgQiAS2rgoVCqcLZjX49s8Zqqx+MRBWeSM4NX",
	"YevL+/+GhWB+6A==",
	"-----END CERTIFICATE-----",
].join("\n");

/** Strip the PEM markers down to the raw base64 body for the DER-input test. */
export function pemToBase64Der(pem: string): string {
	return pem
		.replace(/-----BEGIN CERTIFICATE-----/, "")
		.replace(/-----END CERTIFICATE-----/, "")
		.replace(/\s+/g, "");
}
