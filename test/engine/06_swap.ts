import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { BigNumberish, constants, utils } from 'ethers';
import { defaultAbiCoder, keccak256 } from 'ethers/lib/utils';
import { waffle } from 'hardhat';
import { MockCaller, MockEngine, MockERC20 } from '../../typechain';
import { engineWithPoolFixture } from '../shared/fixtures';
import { getEvent } from '../shared/utils';

describe('engine swap', () => {
  let engine: MockEngine;
  let caller: MockCaller;
  let token0: MockERC20;
  let token1: MockERC20;
  let user: SignerWithAddress;
  let poolId: string;

  const getAccBalance = async (token: string, owner: string, accId: number) => {
    const accHash = keccak256(defaultAbiCoder.encode(['address', 'uint256'], [owner, accId]));
    return await engine.accounts(token, accHash);
  };

  const swap = async (
    params?: Partial<{
      tokenIn: string;
      tokenOut: string;
      tierChoices: number;
      amountDesired: BigNumberish;
      recipient: string;
      recipientAccId: number;
      senderAccId: number;
      callbackAction: string;
    }>,
  ) => {
    return await caller.swap(
      params?.tokenIn ?? token0.address,
      params?.tokenOut ?? token1.address,
      params?.tierChoices ?? 0b111111,
      params?.amountDesired ?? 10000,
      params?.recipient ?? user.address,
      params?.recipientAccId ?? 0,
      params?.senderAccId ?? 0,
      params?.callbackAction ?? utils.id(''),
    );
  };

  beforeEach(async () => {
    ({ engine, caller, token0, token1, user, poolId } = await waffle.loadFixture(engineWithPoolFixture));
  });

  it('pool not exists', async () => {
    await expect(swap({ tokenOut: user.address })).to.be.revertedWith('');
    await expect(swap({ tokenOut: constants.AddressZero })).to.be.revertedWith('');
  });

  it('not enough token in', async () => {
    await expect(swap({ callbackAction: utils.id('NO_TOKEN_IN') })).to.be.revertedWith('NotEnoughToken()');
  });

  it('exact input', async () => {
    const reserve0Before = await token0.balanceOf(engine.address);
    const reserve1Before = await token1.balanceOf(engine.address);
    const userBalance1Before = await token1.balanceOf(user.address);
    const protocolFeeAmt0Before = (await engine.tokens(token0.address)).protocolFeeAmt;

    // perform swap
    const tx = await swap();

    // check event
    const event = await getEvent(tx, engine, 'Swap');
    expect(event.poolId).eq(poolId);
    expect(event.sender).eq(caller.address);
    expect(event.recipient).eq(user.address);
    expect(event.amount0).eq(10000);
    expect(event.amount1).lt(0);
    expect(event.amountInDistribution).gt(0);
    expect(event.tierData[0]).gt(0);

    // check amounts of token transferred
    const amount0 = +event.amount0;
    const amount1 = +event.amount1;
    expect((await token0.balanceOf(engine.address)).sub(reserve0Before)).eq(amount0);
    expect((await token1.balanceOf(engine.address)).sub(reserve1Before)).eq(amount1);
    expect((await token1.balanceOf(user.address)).sub(userBalance1Before)).eq(-amount1);

    // check protocol fee accrued
    expect((await engine.tokens(token0.address)).protocolFeeAmt).gt(protocolFeeAmt0Before);
  });

  it('exact output', async () => {
    const reserve0Before = await token0.balanceOf(engine.address);
    const reserve1Before = await token1.balanceOf(engine.address);
    const userBalance1Before = await token1.balanceOf(user.address);
    const protocolFeeAmt0Before = (await engine.tokens(token0.address)).protocolFeeAmt;

    // perform swap
    const tx = await swap({ amountDesired: -10000 });

    // check event
    const event = await getEvent(tx, engine, 'Swap');
    expect(event.poolId).eq(poolId);
    expect(event.sender).eq(caller.address);
    expect(event.recipient).eq(user.address);
    expect(event.amount0).gt(0);
    expect(event.amount1).eq(-10000);
    expect(event.amountInDistribution).gt(0);
    expect(event.tierData[0]).gt(0);

    // check amounts of token transferred
    const amount0 = +event.amount0;
    const amount1 = +event.amount1;
    expect((await token0.balanceOf(engine.address)).sub(reserve0Before)).eq(amount0);
    expect((await token1.balanceOf(engine.address)).sub(reserve1Before)).eq(amount1);
    expect((await token1.balanceOf(user.address)).sub(userBalance1Before)).eq(-amount1);

    // check protocol fee accrued
    expect((await engine.tokens(token0.address)).protocolFeeAmt).gt(protocolFeeAmt0Before);
  });

  it('zero resulting input and output', async () => {
    const reserve0Before = await token0.balanceOf(engine.address);
    const reserve1Before = await token1.balanceOf(engine.address);
    const tx = await swap({ amountDesired: 1 });

    // check that the swap is too small so it is zero input ouput
    const event = await getEvent(tx, engine, 'Swap');
    expect(event.amount0).eq(0);
    expect(event.amount1).eq(0);

    // check zero token transfered
    expect(await token0.balanceOf(engine.address)).eq(reserve0Before);
    expect(await token1.balanceOf(engine.address)).eq(reserve1Before);
  });

  it('to recipient internal account', async () => {
    const reserve1Before = await token1.balanceOf(engine.address);
    const accBalance1Before = await getAccBalance(token1.address, user.address, 1);

    await swap({ amountDesired: -10000, recipient: user.address, recipientAccId: 1 });

    // check no token left the contract, and recipient internal balance increased
    expect(await token1.balanceOf(engine.address)).eq(reserve1Before);
    expect(await getAccBalance(token1.address, user.address, 1)).eq(accBalance1Before.add(10000));
  });

  context('from sender internal account', () => {
    const run = async (internalBalance: number) => {
      const amountDesired = 10000;
      const transferAmount = amountDesired - internalBalance;
      expect(internalBalance >= 0 && internalBalance <= amountDesired).to.be.true;

      // show we have zero internal balance
      expect(await getAccBalance(token0.address, caller.address, 1)).eq(0);

      // add some internal balance
      await engine.addAccountBalance(caller.address, 1, token0.address, internalBalance);

      // get current token balances in engine
      const reserve0Before = await token0.balanceOf(engine.address);

      // perform swap
      const tx = await swap({ amountDesired, senderAccId: 1 });
      const event = await getEvent(tx, engine, 'Swap');
      expect(event.amount0).eq(amountDesired);

      // check amount of tokens "transfered" in
      expect((await token0.balanceOf(engine.address)).sub(reserve0Before)).eq(transferAmount);

      // check internal balances are used up
      expect(await getAccBalance(token0.address, caller.address, 1)).eq(0);
    };

    it('cover all input', async () => {
      await run(10000);
    });

    it('cover partial input', async () => {
      await run(3000);
    });

    it('cover zero input', async () => {
      await run(0);
    });
  });
});
