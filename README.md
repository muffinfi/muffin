## Protocol introduction

Deliswap Muffin Pool is an AMM protocol that supports concentrated liquidity and multiple swap fees in one pool.

Side features include internal balances and single-contract design, for gas optimization.

## Entry points

- [`Engine.sol`](./contracts/Engine.sol): The sole contract that stores all liquidity pool and is called by user for any swaps and mint/burn liquidity. It contains the logics for token transfer and internal balances.

- [`Pool.sol`](./contracts/libraries/Pools.sol): The library to perform all the functionalities of a liquidity pool, including swap and mint/burn liquidity. Used by `Engine.sol` to perform any pool-level actions.

- [`Manager.sol`](./contracts/periphery/Manager.sol): It is a position manager contract, i.e. wrapping pool positions into ERC721 tokens. It also routes token deposit/withdrawal and token swaps for users, so that users can use the same internal account for both LP-ing and swapping.

## TODOs

- [x] Engine interfaces + NatSpec
- [ ] Manager interfaces + NatSpec
- [ ] Unit tests
- [ ] Technical docs
