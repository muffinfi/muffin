// SPDX-License-Identifier: GPL-3.0-only
pragma solidity >=0.8.0;

import "../IEngineBase.sol";
import "../IEngineEvents.sol";
import "./IEnginePositionsActions.sol";
import "./IEnginePositionsView.sol";

interface IEnginePositions is IEngineBase, IEngineEvents, IEnginePositionsActions, IEnginePositionsView {}
