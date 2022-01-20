# Muffin

**Muffin** is an AMM protocol that supports concentrated liquidity and multiple fee tiers inside one pool.

Side features include limit order, single-contract design, internal balances and EMA oracle.

## Entry points

- [`FEATURES.md`](./FEATURES.md): Introduction of the feature set offered by this protocol

- [`MuffinHub.sol`](./contracts/MuffinHub.sol): The sole contract that stores all liquidity pool and is called by user for any swaps and mint/burn liquidity. It contains the logics for token transfer and internal balances.

- [`Pools.sol`](./contracts/libraries/Pools.sol): The library to perform all the functionalities of a liquidity pool, including swap and mint/burn liquidity. Used by `MuffinHub.sol` to perform any pool-level actions.

- [`Manager.sol`](./contracts/periphery/Manager.sol): The primiary role of this contract is a position manager, i.e. wrapping positions into ERC721 tokens. It also routes token deposit/withdrawal and swaps for users, so users can use the same internal account for both LP-ing and swapping.

## TODOs

- [x] MuffinHub interfaces + NatSpec
- [x] Manager NatSpec
- [x] Unit tests
- [ ] Technical docs
