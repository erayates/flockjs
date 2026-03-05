# Security Policy

## Supported Versions

FlockJS is pre-`v1.0`. Security fixes are currently applied to the `main` branch.

| Version          | Supported   |
| ---------------- | ----------- |
| `main`           | Yes         |
| Pre-release tags | Best effort |

## Reporting a Vulnerability

Please do **not** report security vulnerabilities in public GitHub issues.

Use GitHub's private vulnerability reporting flow:

1. Open the repository security page: <https://github.com/erayates/flockjs/security>
2. Choose **Report a vulnerability** (GitHub Private Vulnerability Reporting).
3. Include:
   - A clear description of the issue
   - Reproduction steps or proof of concept
   - Impact assessment
   - Suggested mitigation (if known)

If private vulnerability reporting is unavailable in your interface, open a GitHub Discussion requesting private maintainer contact without disclosing exploit details:

- <https://github.com/erayates/flockjs/discussions>

## Response Expectations

Project maintainers target:

- Initial acknowledgment within `48 hours`
- Triage decision within `7 days`
- Fix timeline communicated after triage

Response times are best effort and may vary with maintainer availability.

## Security Scope Notes

FlockJS documentation currently covers these security-sensitive areas:

- Room access control and room ID handling
- Relay authentication integration
- Transport security assumptions (WebRTC/DTLS, WSS/TLS)
- Optional end-to-end encryption key management

## Disclosure Policy

After mitigation is available, maintainers may publish:

- A changelog entry
- Upgrade guidance
- Security advisory details

## Related Docs

- [Support](SUPPORT.md)
- [Advanced reference](docs/reference/advanced.md)
- [Performance and scaling](docs/reference/performance.md)
