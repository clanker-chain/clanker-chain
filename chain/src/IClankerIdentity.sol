// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Stable read ABI so a successor can walk priors (docs/registry-lifecycle.md).
///         Do not remove or repurpose these getters.
interface IClankerIdentity {
    function operators(bytes32 id)
        external
        view
        returns (address owner, uint64 registeredAt, uint64 revokedAt);

    function bots(bytes32 id)
        external
        view
        returns (bytes32 operatorId, address botKey, uint64 registeredAt, uint64 revokedAt);

    function priorRegistry() external view returns (address);
}
