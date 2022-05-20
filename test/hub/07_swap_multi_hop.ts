import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { BigNumber, utils } from 'ethers';
import { defaultAbiCoder, keccak256, solidityPack } from 'ethers/lib/utils';
import { waffle } from 'hardhat';
import { IMockMuffinHub, MockCaller, MockERC20 } from '../../typechain';
import { MAX_TICK, MIN_TICK } from '../shared/constants';
import { hubWithTwoPoolsFixture } from '../shared/fixtures';
import { getEvents } from '../shared/utils';

const EXTRA_INTERMEDIATE_OUTPUT = 100;

describe('hub swap multi hop', () => {
  let hub: IMockMuffinHub;
  let caller: MockCaller;
  let token0: MockERC20;
  let token1: MockERC20;
  let token2: MockERC20;
  let user: SignerWithAddress;
  let poolId01: string;
  let poolId12: string;
  let poolId02: string;

  let reserve0Before: BigNumber;
  let reserve1Before: BigNumber;
  let reserve2Before: BigNumber;

  let userBalance0Before: BigNumber;
  let userBalance1Before: BigNumber;
  let userBalance2Before: BigNumber;

  let protocolFeeAmt0Before: BigNumber;
  let protocolFeeAmt1Before: BigNumber;
  let protocolFeeAmt2Before: BigNumber;

  beforeEach(async () => {
    ({ hub, caller, token0, token1, token2, user, poolId01, poolId12, poolId02 } = await waffle.loadFixture(
      hubWithTwoPoolsFixture,
    ));
    reserve0Before = await token0.balanceOf(hub.address);
    reserve1Before = await token2.balanceOf(hub.address);
    reserve2Before = await token2.balanceOf(hub.address);

    userBalance0Before = await token0.balanceOf(user.address);
    userBalance1Before = await token1.balanceOf(user.address);
    userBalance2Before = await token2.balanceOf(user.address);

    protocolFeeAmt0Before = (await hub.tokens(token0.address)).protocolFeeAmt;
    protocolFeeAmt1Before = (await hub.tokens(token1.address)).protocolFeeAmt;
    protocolFeeAmt2Before = (await hub.tokens(token2.address)).protocolFeeAmt;
  });

  const mint = async (params?: Partial<Parameters<MockCaller['functions']['mint']>[0]>) => {
    return await caller.mint({
      token0: token0.address,
      token1: token1.address,
      tierId: 0,
      tickLower: MIN_TICK,
      tickUpper: MAX_TICK,
      liquidityD8: 100,
      recipient: user.address,
      positionRefId: 1,
      senderAccRefId: 0,
      data: [],
      ...params,
    });
  };

  const swapMultiHop = async (params?: Partial<Parameters<MockCaller['functions']['swapMultiHop']>[0]>) => {
    return await caller.swapMultiHop({
      path: [],
      amountDesired: 10000,
      recipient: user.address,
      recipientAccRefId: 0,
      senderAccRefId: 0,
      data: utils.id(''),
      ...params,
    });
  };

  const toPath = (tokens: MockERC20[]) => {
    const types = [];
    const values = [];
    for (const token of tokens) {
      types.push('address');
      types.push('uint8');
      values.push(token.address);
      values.push(0b111111);
    }
    types.pop();
    values.pop();
    return solidityPack(types, values);
  };

  const checkEventSenderRecipient = (
    events: any[],
    exactIn: boolean,
    senderAccRefId: number = 0,
    recipientAccRefId: number = 0,
  ) => {
    for (const [i, event] of events.entries()) {
      expect(event.sender).eq(caller.address);
      expect(event.senderAccRefId).eq(senderAccRefId);

      if (exactIn ? i == events.length - 1 : i == 0) {
        expect(event.recipient).eq(user.address);
        expect(event.recipientAccRefId).eq(recipientAccRefId);
      } else {
        expect(event.recipient).eq(caller.address);
        expect(event.recipientAccRefId).eq(senderAccRefId);
      }
    }
  };

  const getAccBalance = async (token: string, owner: string, accRefId: number) => {
    const accHash = keccak256(defaultAbiCoder.encode(['address', 'uint256'], [owner, accRefId]));
    return await hub.accounts(token, accHash);
  };

  it('invalid path', async () => {
    const path = solidityPack(['address', 'address'], [token0.address, token1.address]);
    await expect(swapMultiHop({ path })).to.be.revertedWith('InvalidSwapPath()');
    await expect(swapMultiHop()).to.be.revertedWith('InvalidSwapPath()');
  });

  it('pool not exists', async () => {
    const path = solidityPack(['address', 'uint8', 'address'], [token0.address, 0b111111, user.address]);
    await expect(swapMultiHop({ path })).to.be.revertedWith('');
  });

  context('exact input', () => {
    it('0 -> 1', async () => {
      const tx = await swapMultiHop({ path: toPath([token0, token1]) });
      const events = await getEvents(tx, hub, 'Swap');
      checkEventSenderRecipient(events, true);

      expect(events[0].poolId).eq(poolId01);
      expect(events[0].amount0).eq(10000);
      expect(events[0].amount1).lt(0);

      const amount0 = +events[0].amount0;
      const amount1 = +events[0].amount1;

      expect((await token0.balanceOf(hub.address)).sub(reserve0Before)).eq(amount0);
      expect((await token1.balanceOf(hub.address)).sub(reserve1Before)).eq(amount1);
      expect((await token1.balanceOf(user.address)).sub(userBalance1Before)).eq(-amount1);
      expect((await hub.tokens(token0.address)).protocolFeeAmt).gt(protocolFeeAmt0Before);
    });

    it('0 -> 1 (to recipient internal account)', async () => {
      const recipientAccRefId = 1;
      const accBalance1Before = await getAccBalance(token1.address, user.address, recipientAccRefId);

      const tx = await swapMultiHop({ path: toPath([token0, token1]), recipientAccRefId });
      const events = await getEvents(tx, hub, 'Swap');
      checkEventSenderRecipient(events, true, 0, recipientAccRefId);

      expect(events[0].poolId).eq(poolId01);
      expect(events[0].amount0).eq(10000);
      expect(events[0].amount1).lt(0);

      const amount0 = +events[0].amount0;
      const amount1 = +events[0].amount1; // it's negative

      expect((await token0.balanceOf(hub.address)).sub(reserve0Before)).eq(amount0);
      expect((await token1.balanceOf(hub.address)).sub(reserve1Before)).eq(0);
      expect((await token1.balanceOf(user.address)).sub(userBalance1Before)).eq(0);
      expect((await hub.tokens(token0.address)).protocolFeeAmt).gt(protocolFeeAmt0Before);

      expect((await getAccBalance(token1.address, user.address, recipientAccRefId)).sub(accBalance1Before)).eq(-amount1);
    });

    it('0 -> 1 -> 2', async () => {
      const tx = await swapMultiHop({ path: toPath([token0, token1, token2]) });
      const events = await getEvents(tx, hub, 'Swap');
      checkEventSenderRecipient(events, true);

      expect(events[0].poolId).eq(poolId01);
      expect(events[0].amount0).eq(10000);
      expect(events[0].amount1).lt(0);

      expect(events[1].poolId).eq(poolId12);
      expect(events[1].amount0).eq(-events[0].amount1);
      expect(events[1].amount1).lt(0);

      const amount0 = +events[0].amount0;
      const amount2 = +events[1].amount1;

      expect((await token0.balanceOf(hub.address)).sub(reserve0Before)).eq(amount0);
      expect((await token1.balanceOf(hub.address)).sub(reserve1Before)).eq(0);
      expect((await token2.balanceOf(hub.address)).sub(reserve2Before)).eq(amount2);

      expect((await token1.balanceOf(user.address)).sub(userBalance1Before)).eq(0);
      expect((await token2.balanceOf(user.address)).sub(userBalance2Before)).eq(-amount2);

      expect((await hub.tokens(token0.address)).protocolFeeAmt).gt(protocolFeeAmt0Before);
      expect((await hub.tokens(token1.address)).protocolFeeAmt).gt(protocolFeeAmt1Before);
    });

    it('0 -> 1 -> 2 -> 0', async () => {
      const tx = await swapMultiHop({ path: toPath([token0, token1, token2, token0]) });
      const events = await getEvents(tx, hub, 'Swap');
      checkEventSenderRecipient(events, true);

      expect(events[0].poolId).eq(poolId01);
      expect(events[0].amount0).eq(10000);
      expect(events[0].amount1).lt(0);

      expect(events[1].poolId).eq(poolId12);
      expect(events[1].amount0).eq(-events[0].amount1);
      expect(events[1].amount1).lt(0);

      expect(events[2].poolId).eq(poolId02);
      expect(events[2].amount1).eq(-events[1].amount1);
      expect(events[2].amount0).lt(0);

      const amount0Delta = +events[0].amount0 + +events[2].amount0;
      expect(amount0Delta).gt(0);

      expect((await token0.balanceOf(hub.address)).sub(reserve0Before)).eq(amount0Delta);
      expect((await token1.balanceOf(hub.address)).sub(reserve1Before)).eq(0);
      expect((await token2.balanceOf(hub.address)).sub(reserve2Before)).eq(0);

      expect((await hub.tokens(token0.address)).protocolFeeAmt).gt(protocolFeeAmt0Before);
      expect((await hub.tokens(token1.address)).protocolFeeAmt).gt(protocolFeeAmt1Before);
      expect((await hub.tokens(token2.address)).protocolFeeAmt).gt(protocolFeeAmt2Before);
    });
  });

  context('exact output', () => {
    it('0 <- 1', async () => {
      const tx = await swapMultiHop({ amountDesired: -10000, path: toPath([token0, token1]) });
      const events = await getEvents(tx, hub, 'Swap');
      checkEventSenderRecipient(events, false);

      expect(events[0].poolId).eq(poolId01);
      expect(events[0].amount0).eq(-10000);
      expect(events[0].amount1).gt(0);

      const amount0 = +events[0].amount0; // negative
      const amount1 = +events[0].amount1; // positive

      expect((await token0.balanceOf(hub.address)).sub(reserve0Before)).eq(amount0);
      expect((await token1.balanceOf(hub.address)).sub(reserve1Before)).eq(amount1);

      expect((await token0.balanceOf(user.address)).sub(userBalance0Before)).eq(-amount0);

      expect((await hub.tokens(token1.address)).protocolFeeAmt).gt(protocolFeeAmt1Before);
    });

    it('0 <- 1 <- 2', async () => {
      const tx = await swapMultiHop({ amountDesired: -10000, path: toPath([token0, token1, token2]) });
      const events = await getEvents(tx, hub, 'Swap');
      checkEventSenderRecipient(events, false);

      expect(events[0].poolId).eq(poolId01);
      expect(events[0].amount0).eq(-10000);
      expect(events[0].amount1).gt(0);

      expect(events[1].poolId).eq(poolId12);
      expect(events[1].amount0).eq(-events[0].amount1 - EXTRA_INTERMEDIATE_OUTPUT);
      expect(events[1].amount1).gt(0);

      const amount0 = +events[0].amount0; // negative
      const amount2 = +events[1].amount1; // positive

      expect((await token0.balanceOf(hub.address)).sub(reserve0Before)).eq(amount0);
      expect((await token1.balanceOf(hub.address)).sub(reserve1Before)).eq(0);
      expect((await token2.balanceOf(hub.address)).sub(reserve2Before)).eq(amount2);

      expect((await token0.balanceOf(user.address)).sub(userBalance0Before)).eq(-amount0);
      expect((await token1.balanceOf(user.address)).sub(userBalance1Before)).eq(0);

      expect((await hub.tokens(token1.address)).protocolFeeAmt).gt(protocolFeeAmt1Before);
      expect((await hub.tokens(token2.address)).protocolFeeAmt).gt(protocolFeeAmt2Before);
    });

    it('0 <- 1 <- 2 <- 0', async () => {
      const tx = await swapMultiHop({ amountDesired: -5000, path: toPath([token0, token1, token2, token0]) });
      const events = await getEvents(tx, hub, 'Swap');
      checkEventSenderRecipient(events, false);

      expect(events[0].poolId).eq(poolId01);
      expect(events[0].amount0).eq(-5000);
      expect(events[0].amount1).gt(0);

      expect(events[1].poolId).eq(poolId12);
      expect(events[1].amount0).eq(-events[0].amount1 - EXTRA_INTERMEDIATE_OUTPUT);
      expect(events[1].amount1).gt(0);

      expect(events[2].poolId).eq(poolId02);
      expect(events[2].amount1).eq(-events[1].amount1 - EXTRA_INTERMEDIATE_OUTPUT);
      expect(events[2].amount0).gt(0);

      const amount0Delta = +events[0].amount0 + +events[2].amount0;
      expect(amount0Delta).gt(0);

      expect((await token0.balanceOf(hub.address)).sub(reserve0Before)).eq(amount0Delta);
      expect((await token1.balanceOf(hub.address)).sub(reserve1Before)).eq(0);
      expect((await token2.balanceOf(hub.address)).sub(reserve2Before)).eq(0);

      expect((await hub.tokens(token0.address)).protocolFeeAmt).gt(protocolFeeAmt0Before);
      expect((await hub.tokens(token1.address)).protocolFeeAmt).gt(protocolFeeAmt1Before);
      expect((await hub.tokens(token2.address)).protocolFeeAmt).gt(protocolFeeAmt2Before);
    });

    context('special cases in intermediate swaps', () => {
      it('2 <- 1 <- 0: prevented insufficient output in intermediate swap', async () => {
        /**
         * This test case fails if we do not add extra output amount in the intermediate swaps.
         */

        // initialize pool01's 0-th tick. this makes the 2nd swap in the path need to cross tick
        await mint({ tickLower: 0, tickUpper: 1 });

        const tx = await swapMultiHop({ amountDesired: -1, path: toPath([token2, token1, token0]) });
        const events = await getEvents(tx, hub, 'Swap');
        expect(events[0].poolId).eq(poolId12);
        expect(events[0].amount0).eq(3);
        expect(events[0].amount1).eq(-1);

        // if we did not pad the desired "3" output amount to "103", we would have failed the tx
        expect(events[1].poolId).eq(poolId01);
        expect(events[1].amount0).eq(105);
        expect(events[1].amount1).eq(-103);
      });

      it('0 <- 1 <- 2: intermediate swap hitting end tick', async () => {
        // perform a multihop which the intermediate step _almost but does not_ hit end tick
        const tx = await swapMultiHop({ amountDesired: -12780, path: toPath([token0, token1, token2]) });
        const events = await getEvents(tx, hub, 'Swap');

        // note that the 2nd swap almost takes out all token1 in the token1-token2 pool
        expect(events[0].poolId).eq(poolId01);
        expect(events[0].amount0).eq(-12780);
        expect(events[0].amount1).eq(25598);
        // and note that in 2nd swap we requested a 25598+100 output amount as we padded an extra output amount to
        // ensure sufficient output for the 1st swap. explained in the test above.
        expect(events[1].poolId).eq(poolId12);
        expect(events[1].amount0).eq(-25599);
        expect(events[1].amount1).eq('1850160055305684646970');

        // perform a multihop which the 2nd swap ends without receiving the full desired amount for 1st swap, due to
        // the 2nd swap being too large and only partially processed as the tier hits end tick and stops the swap early
        await expect(swapMultiHop({ amountDesired: -12781, path: toPath([token0, token1, token2]) })).to.be.revertedWith(
          'NotEnoughIntermediateOutput()',
        );
      });
    });
  });
});
