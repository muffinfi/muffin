import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { utils } from 'ethers';
import { defaultAbiCoder, keccak256 } from 'ethers/lib/utils';
import { waffle } from 'hardhat';
import { MockCaller, IMockMuffinHub, MockERC20 } from '../../typechain';
import { MAX_TICK, MIN_TICK } from '../shared/constants';
import { hubWithPoolFixture } from '../shared/fixtures';
import { bn, getEvent } from '../shared/utils';

const ACC_REF_ID = 1;
const POS_REF_ID = 777;

describe('hub mint', () => {
  let hub: IMockMuffinHub;
  let caller: MockCaller;
  let token0: MockERC20;
  let token1: MockERC20;
  let user: SignerWithAddress;
  let poolId: string;

  const getAccBalance = async (token: string, owner: string, accRefId: number) => {
    const accHash = keccak256(defaultAbiCoder.encode(['address', 'uint256'], [owner, accRefId]));
    return await hub.accounts(token, accHash);
  };

  const mint = async (params?: Partial<Parameters<MockCaller['functions']['mint']>[0]>) => {
    return await caller.mint({
      token0: token0.address,
      token1: token1.address,
      tierId: 0,
      tickLower: MIN_TICK,
      tickUpper: MAX_TICK,
      liquidityD8: 1,
      recipient: user.address,
      positionRefId: POS_REF_ID,
      senderAccRefId: 0,
      data: [],
      ...params,
    });
  };

  beforeEach(async () => {
    ({ hub, caller, token0, token1, user, poolId } = await waffle.loadFixture(hubWithPoolFixture));
  });

  it('invalid token order', async () => {
    await expect(mint({ token0: token1.address, token1: token0.address })).to.be.revertedWith('');
  });

  it('liquidityD8 > type(int96).max', async () => {
    await expect(mint({ liquidityD8: bn(1).shl(96).sub(1) })).to.be.revertedWith('');
  });

  it('not enough token0 in', async () => {
    await expect(mint({ data: utils.id('NO_TOKEN0_IN') })).to.be.revertedWith('NotEnoughTokenInput()');
  });

  it('not enough token1 in', async () => {
    await expect(mint({ data: utils.id('NO_TOKEN1_IN') })).to.be.revertedWith('NotEnoughTokenInput()');
  });

  it('mint successfully using token transfer', async () => {
    const reserve0Before = await token0.balanceOf(hub.address);
    const reserve1Before = await token1.balanceOf(hub.address);
    await expect(mint())
      .to.emit(hub, 'Mint')
      .withArgs(poolId, user.address, POS_REF_ID, 0, MIN_TICK, MAX_TICK, caller.address, 0, 1, 256, 256);
    expect((await token0.balanceOf(hub.address)).sub(reserve0Before)).eq(256);
    expect((await token1.balanceOf(hub.address)).sub(reserve1Before)).eq(256);
  });

  context('use internal account', () => {
    const run = async (internalBalance: number) => {
      expect(internalBalance >= 0 && internalBalance <= 256).to.be.true;
      const transferAmount = 256 - internalBalance;

      // show we have zero internal balance
      expect(await getAccBalance(token0.address, caller.address, ACC_REF_ID)).eq(0);
      expect(await getAccBalance(token1.address, caller.address, ACC_REF_ID)).eq(0);

      // add some internal balance
      await hub.addAccountBalance(caller.address, ACC_REF_ID, token0.address, internalBalance);
      await hub.addAccountBalance(caller.address, ACC_REF_ID, token1.address, internalBalance);

      // get current token balances in hub
      const reserve0Before = await token0.balanceOf(hub.address);
      const reserve1Before = await token1.balanceOf(hub.address);

      // perform mint
      const noNeedCallback = internalBalance == 256;
      const tx = await mint({ senderAccRefId: ACC_REF_ID, data: noNeedCallback ? utils.id('UNKNOWN') : [] });

      // check amount of tokens "transfered" in
      expect((await token0.balanceOf(hub.address)).sub(reserve0Before)).eq(transferAmount);
      expect((await token1.balanceOf(hub.address)).sub(reserve1Before)).eq(transferAmount);

      // check internal balances are used up
      expect(await getAccBalance(token0.address, caller.address, ACC_REF_ID)).eq(0);
      expect(await getAccBalance(token1.address, caller.address, ACC_REF_ID)).eq(0);

      // check event data and return values not affected by switching on/off internal account
      const event = await getEvent(tx, hub, 'Mint');
      expect(event.amount0).eq(256);
      expect(event.amount1).eq(256);
      expect(event.sender).eq(caller.address);
      expect(event.senderAccRefId).eq(ACC_REF_ID);
    };

    it('cover all input', async () => {
      await run(256);
    });

    it('cover partial input', async () => {
      await run(200);
    });

    it('cover zero input', async () => {
      await run(0);
    });
  });
});
