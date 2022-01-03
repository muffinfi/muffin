// SPDX-License-Identifier: GPL-3.0-only
pragma solidity >=0.8.0;

import "./IEngineEvents.sol";
import "./IEngineActions.sol";
import "./IEngineSettings.sol";
import "./IEngineView.sol";

interface IEngine is IEngineEvents, IEngineActions, IEngineSettings, IEngineView {}
