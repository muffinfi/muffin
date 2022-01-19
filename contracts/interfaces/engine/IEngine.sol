// SPDX-License-Identifier: GPL-3.0-only
pragma solidity >=0.8.0;

import "./IEngineBase.sol";
import "./IEngineEvents.sol";
import "./IEngineActions.sol";
import "./IEngineGatedActions.sol";
import "./IEngineView.sol";

interface IEngine is IEngineBase, IEngineEvents, IEngineActions, IEngineGatedActions, IEngineView {}
