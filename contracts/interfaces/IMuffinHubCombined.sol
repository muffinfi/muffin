// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.0;

import "./hub/IMuffinHub.sol";
import "./hub/positions/IMuffinHubPositions.sol";

interface IMuffinHubCombined is IMuffinHub, IMuffinHubPositions {}
