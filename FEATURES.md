# Muffin

**Muffin** is an AMM protocol that supports concentrated liquidity and multiple fee tiers inside one pool.

Side features include limit order, single-contract design, internal balances and EMA oracle.

## Features

### Concentrated liquidity

Similar to the common implementation of concentrated liquidity, the price of a token pair is partitioned into ticks. Liquidity providers (LPs) can decide their own tick range to put their liquidity on, and earn fees from the swaps that are processed in their selected tick range.

When the price leaves their tick range, their position will not be serving as the active liquidity of the pool. Meanwhile, their positions become "singled-sided" — consists of only one side of the two tokens in the pool

### Multiple fee tiers in one pool

The common design of liquidity pool has been "one fixed swap fee tier for one pool", and to create several pools with different fee tiers to suit the market.

In Muffin, we change the design to "multiple fee tiers for one pool" and create only one pool to serve the needs of different fee tiers desired by the market. The hierarchical change enables a data structure that makes cross-tier order optimization more gas-efficient and tractable on-chain.

For traders, when an order comes into Muffin, the protocol will divide the incoming order into several smaller orders, and route them into different tiers to get the most optimal rate for traders. For LPs, they will pick a fee tier and tick range by themselves for their own positions, as if LP-ing in the current common concentrated liquidity AMMs.

### Limit orders

Uniswap V3 introduced a new order type called "range order". Under the hood, it refers to traders depositing a position and sells tokens along the AMM curve when the price moves.

Depositing to a narrow price range can imitate a traditional limit order. However, it requires traders to withdraw liqudity once they fully sell their tokens to avoid automatically buying back what they just sold.

In Muffin, we offer traders to set their range order (or position) as a "limit order". As the price moves during a swap, once their range order has fully converted into one type of token, the protocol will "settle" their range order as if they have withdrawn liquidity. Their position's liquidity will not be put into service again when the price moves back. This is similar to the traditional limit orders being filled and executed.

### Single-contract design

In contracts with the common way of creating one contract account (CA) per pool, all pools of Muffin stay inside one contract account, i.e. under one contract address.

With this design, token reserves of all pools are stored under one address. It allows a much lower gas cost to perform multihop swap, as we no longer need to transfer intermediate tokens accross contracts. It also remove the needs of calling multiple pool contracts and the needs of having an external router contract to orchestrate the multihop routing.

### Internal balances

Muffin allows users to deposit tokens into their internal accounts in the contract, which can then be used in swapping, adding/removing liquidity. Along with the previously mentioned single-contract design, the primary objective is to reduce the needs of token transfers for frequent traders and active liquidity providers, and hence to lower gas cost.

### Unified TWAP

Each tier in a Muffin's pool has its own liquidity and price. But rather than having one TWAP for each tier, the protocol calculates an geometric mean of the gm-TWAP, weighted by the amounts of liquidity of the tiers in the pool. It preserves a strong resistance to TWAP manipulation even if liquidity is scattered into different tiers.

### EMA

The protocol provides 20-min EMA and 40-min EMA of the TWAP of each pool, so oracle users can query TWAP of a generally reasonable period without (1) doing two contract calls, or (2) prepaying storage slots for one-call TWAP.

## Data Hierarchy

As mentioned above, we use one single contracts to store all liquidity pools and handle all swaps and adding/removing liquidity for all pools. We call this contract the "hub".

The **hub** contains all **pool** states. Inside each pools, there are up to six **tiers**. Each tier has its own price, liquidity and **tick** states. All of them are inside one contract.

![](https://i.imgur.com/lRREZys.png)
