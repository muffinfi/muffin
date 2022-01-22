import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { constants } from 'ethers';
import { defaultAbiCoder, keccak256 } from 'ethers/lib/utils';
import { ethers, waffle } from 'hardhat';
import { Manager, IMockMuffinHub, MockERC20, WETH9 } from '../../typechain';
import { LimitOrderType } from '../shared/constants';
import { managerFixture } from '../shared/fixtures';
import { bn, deploy, expectBalanceChanges, getEvent } from '../shared/utils';

const Q72 = bn(1).shl(72);
const FIRST_TOKEN_ID = 1;

describe('manager position manager', () => {
  let hub: IMockMuffinHub;
  let manager: Manager;
  let token0: MockERC20;
  let token1: MockERC20;
  let token2: MockERC20;
  let poolId01: string;
  let weth: WETH9;
  let user: SignerWithAddress;
  let other: SignerWithAddress;

  beforeEach(async () => {
    ({ hub, manager, token0, token1, token2, weth, poolId01, user, other } = await waffle.loadFixture(managerFixture));
  });

  const getAccBalance = async (token: string, userAddress: string) => {
    const accHash = keccak256(defaultAbiCoder.encode(['address', 'uint256'], [manager.address, bn(userAddress)]));
    return await hub.accounts(token, accHash);
  };

  const checkEthBalanceChanges = async (
    ethDeltas: [number, number, number],
    wethDeltas: [number, number, number],
    fn: () => any,
  ) => {
    const userEthBefore = await ethers.provider.getBalance(user.address);
    const managerEthBefore = await ethers.provider.getBalance(manager.address);
    const reserveEthBefore = await ethers.provider.getBalance(hub.address);

    const userWethBefore = await weth.balanceOf(user.address);
    const managerWethBefore = await weth.balanceOf(manager.address);
    const reserveWethBefore = await weth.balanceOf(hub.address);

    const retval = await fn();

    // check eth balance changes
    expect((await ethers.provider.getBalance(user.address)).sub(userEthBefore)).eq(ethDeltas[0]);
    expect((await ethers.provider.getBalance(manager.address)).sub(managerEthBefore)).eq(ethDeltas[1]);
    expect((await ethers.provider.getBalance(hub.address)).sub(reserveEthBefore)).eq(ethDeltas[2]);

    // check weth balance changes
    expect((await weth.balanceOf(user.address)).sub(userWethBefore)).eq(wethDeltas[0]);
    expect((await weth.balanceOf(manager.address)).sub(managerWethBefore)).eq(wethDeltas[1]);
    expect((await weth.balanceOf(hub.address)).sub(reserveWethBefore)).eq(wethDeltas[2]);

    return retval;
  };

  context('create pool', () => {
    it('create pool successfully', async () => {
      // deploy a new token
      const token4 = (await deploy('MockERC20', 'AAA Token', 'AAA')) as MockERC20;
      await token4.mint(1e12);
      await token4.approve(manager.address, 1e12);
      const tokens = token0.address.toLowerCase() < token4.address.toLowerCase() ? [token0, token4] : [token4, token0];
      const poolId = keccak256(defaultAbiCoder.encode(['address', 'address'], [tokens[0].address, tokens[1].address]));

      await expectBalanceChanges(
        [
          { account: user, token: tokens[0], delta: -25600 },
          { account: user, token: tokens[1], delta: -25600 },
          { account: hub, token: tokens[0], delta: 25600 },
          { account: hub, token: tokens[1], delta: 25600 },
        ],
        async () => {
          await manager.createPool(tokens[0].address, tokens[1].address, 99850, Q72);

          // check pair cached
          const pair = await manager.pairs(1);
          expect(pair[0]).eq(tokens[0].address);
          expect(pair[1]).eq(tokens[1].address);
          expect(await manager.pairIdsByPoolId(poolId)).eq(1);

          // check pool created
          expect((await hub.getPoolParameters(poolId)).tickSpacing).eq(1);
          expect((await hub.getPoolParameters(poolId)).protocolFee).eq(25);
        },
      );
    });

    it('try to create existing pool', async () => {
      await expectBalanceChanges(
        [
          { account: user, token: token0, delta: 0 },
          { account: user, token: token1, delta: 0 },
          { account: hub, token: token0, delta: 0 },
          { account: hub, token: token1, delta: 0 },
        ],
        async () => {
          await manager.createPool(token0.address, token1.address, 99850, Q72);

          // check pair cached
          const pair = await manager.pairs(1);
          expect(pair[0]).eq(token0.address);
          expect(pair[1]).eq(token1.address);
          expect(await manager.pairIdsByPoolId(poolId01)).eq(1);
        },
      );
    });
  });

  context('mint', () => {
    const baseParams = () => {
      return {
        tierId: 0,
        token0: token0.address,
        token1: token1.address,
        tickLower: -100,
        tickUpper: +100,
        amount0Desired: 25600,
        amount1Desired: 25600,
        amount0Min: 0,
        amount1Min: 0,
        recipient: user.address,
        useAccount: false,
      };
    };

    it('not reaching minimum amount', async () => {
      await expect(manager.mint({ ...baseParams(), amount0Min: 25601, amount1Min: 25601 })).to.be.revertedWith('Price slippage');
    });

    it('mint NFT successfully', async () => {
      const reserve0Before = await token0.balanceOf(hub.address);
      const reserve1Before = await token1.balanceOf(hub.address);
      const userBalance0Before = await token0.balanceOf(user.address);
      const userBalance1Before = await token1.balanceOf(user.address);
      const nftTotalSupplyBefore = await manager.totalSupply();

      const params = baseParams();
      const tx = await manager.mint(params);

      // check token supply
      expect(await manager.totalSupply()).eq(nftTotalSupplyBefore.add(1));

      // check NFT
      const tokenId = +nftTotalSupplyBefore.add(1);
      expect(await manager.ownerOf(tokenId)).eq(params.recipient);

      // check position info
      const info = await manager.positionsByTokenId(tokenId);
      const pair = await manager.pairs(1);
      expect(info.owner).eq(params.recipient);
      expect(info.pairId).eq(1);
      expect(info.tierId).eq(params.tierId);
      expect(info.tickLower).eq(params.tickLower);
      expect(info.tickUpper).eq(params.tickUpper);
      expect(pair[0]).eq(token0.address);
      expect(pair[1]).eq(token1.address);

      // check hub event
      const event = await getEvent(tx, hub, 'Mint');
      expect(event.poolId).eq(poolId01);
      expect(event.owner).eq(manager.address);
      expect(event.positionRefId).eq(tokenId);
      expect(event.owner).eq(manager.address);
      expect(event.tierId).eq(params.tierId);
      expect(event.tickLower).eq(params.tickLower);
      expect(event.tickUpper).eq(params.tickUpper);
      expect(event.liquidityD8).gt(0);

      // check balance changes
      const amount0 = event.amount0;
      const amount1 = event.amount1;
      expect((await token0.balanceOf(hub.address)).sub(reserve0Before)).eq(amount0);
      expect((await token1.balanceOf(hub.address)).sub(reserve1Before)).eq(amount1);
      expect((await token0.balanceOf(user.address)).sub(userBalance0Before)).eq(amount0.mul(-1));
      expect((await token1.balanceOf(user.address)).sub(userBalance1Before)).eq(amount1.mul(-1));
    });

    it('use internal account', async () => {
      await hub.addAccountBalance(manager.address, bn(user.address), token0.address, 1e8);
      await hub.addAccountBalance(manager.address, bn(user.address), token1.address, 1e8);

      const reserve0Before = await token0.balanceOf(hub.address);
      const reserve1Before = await token1.balanceOf(hub.address);
      const userBalance0Before = await token0.balanceOf(user.address);
      const userBalance1Before = await token1.balanceOf(user.address);
      const userAccBalance0Before = await getAccBalance(token0.address, user.address);
      const userAccBalance1Before = await getAccBalance(token1.address, user.address);

      const tx = await manager.mint({ ...baseParams(), useAccount: true });

      // check no real token transfer
      expect((await token0.balanceOf(hub.address)).sub(reserve0Before)).eq(0);
      expect((await token1.balanceOf(hub.address)).sub(reserve1Before)).eq(0);
      expect((await token0.balanceOf(user.address)).sub(userBalance0Before)).eq(0);
      expect((await token1.balanceOf(user.address)).sub(userBalance1Before)).eq(0);

      // check use internal balance used
      const event = await getEvent(tx, hub, 'Mint');
      expect((await getAccBalance(token0.address, user.address)).sub(userAccBalance0Before)).eq(-event.amount0);
      expect((await getAccBalance(token1.address, user.address)).sub(userAccBalance1Before)).eq(-event.amount1);
    });

    it('eth in (multicall: refundETH)', async () => {
      await checkEthBalanceChanges([-25600, 0, 0], [0, 0, 25600], async () => {
        const tx = await manager.multicall(
          [
            manager.interface.encodeFunctionData('mint', [{ ...baseParams(), token0: token2.address, token1: weth.address }]),
            manager.interface.encodeFunctionData('refundETH'),
          ],
          { value: 25600 + 10000 },
        );
        const event = await getEvent(tx, hub, 'Mint');
        expect(event.amount0).eq(25600);
        expect(event.amount1).eq(25600);
      });
    });
  });

  context('add liquidity', () => {
    beforeEach(async () => {
      await manager.mint({
        tierId: 0,
        token0: token0.address,
        token1: token1.address,
        tickLower: -100,
        tickUpper: +100,
        amount0Desired: 0,
        amount1Desired: 0,
        amount0Min: 0,
        amount1Min: 0,
        recipient: user.address,
        useAccount: false,
      });
      expect(await manager.ownerOf(tokenId)).eq(user.address);
    });

    const tokenId = FIRST_TOKEN_ID;
    const baseParams = () => {
      return {
        tokenId,
        amount0Desired: 25600,
        amount1Desired: 25600,
        amount0Min: 0,
        amount1Min: 0,
        useAccount: false,
      };
    };

    it('non-existing token id', async () => {
      await expect(manager.addLiquidity({ ...baseParams(), tokenId: 123 })).to.be.revertedWith(
        'ERC721: approved query for nonexistent token',
      );
    });

    it('not owner + not approved', async () => {
      // check not approved
      await expect(manager.connect(other).addLiquidity(baseParams())).to.be.revertedWith('NOT_APPROVED');

      // check approved
      await manager.approve(other.address, tokenId);
      await token0.mintTo(other.address, 1e8);
      await token1.mintTo(other.address, 1e8);
      await manager.connect(other).addLiquidity(baseParams());
    });

    it('not reaching minimum amount', async () => {
      const params = { ...baseParams(), amount0Min: 25601, amount1Min: 25601 };
      await expect(manager.addLiquidity(params)).to.be.revertedWith('Price slippage');
    });

    it('add liquidity successfully', async () => {
      const reserve0Before = await token0.balanceOf(hub.address);
      const reserve1Before = await token1.balanceOf(hub.address);
      const userBalance0Before = await token0.balanceOf(user.address);
      const userBalance1Before = await token1.balanceOf(user.address);
      const tx = await manager.addLiquidity(baseParams());

      // check hub event
      const event = await getEvent(tx, hub, 'Mint');
      expect(event.poolId).eq(poolId01);
      expect(event.owner).eq(manager.address);
      expect(event.positionRefId).eq(tokenId);
      expect(event.owner).eq(manager.address);
      expect(event.liquidityD8).gt(0);

      // check balance changes
      const amount0 = event.amount0;
      const amount1 = event.amount1;
      expect((await token0.balanceOf(hub.address)).sub(reserve0Before)).eq(amount0);
      expect((await token1.balanceOf(hub.address)).sub(reserve1Before)).eq(amount1);
      expect((await token0.balanceOf(user.address)).sub(userBalance0Before)).eq(amount0.mul(-1));
      expect((await token1.balanceOf(user.address)).sub(userBalance1Before)).eq(amount1.mul(-1));
    });

    it('use internal account', async () => {
      await hub.addAccountBalance(manager.address, bn(user.address), token0.address, 1e8);
      await hub.addAccountBalance(manager.address, bn(user.address), token1.address, 1e8);

      const reserve0Before = await token0.balanceOf(hub.address);
      const reserve1Before = await token1.balanceOf(hub.address);
      const userBalance0Before = await token0.balanceOf(user.address);
      const userBalance1Before = await token1.balanceOf(user.address);
      const userAccBalance0Before = await getAccBalance(token0.address, user.address);
      const userAccBalance1Before = await getAccBalance(token1.address, user.address);

      const tx = await manager.addLiquidity({ ...baseParams(), useAccount: true });

      // check no real token transfer
      expect((await token0.balanceOf(hub.address)).sub(reserve0Before)).eq(0);
      expect((await token1.balanceOf(hub.address)).sub(reserve1Before)).eq(0);
      expect((await token0.balanceOf(user.address)).sub(userBalance0Before)).eq(0);
      expect((await token1.balanceOf(user.address)).sub(userBalance1Before)).eq(0);

      // check use internal balance used
      const event = await getEvent(tx, hub, 'Mint');
      expect((await getAccBalance(token0.address, user.address)).sub(userAccBalance0Before)).eq(-event.amount0);
      expect((await getAccBalance(token1.address, user.address)).sub(userAccBalance1Before)).eq(-event.amount1);
    });

    it('eth in (multicall: refundETH)', async () => {
      await manager.mint({
        tierId: 0,
        token0: token2.address,
        token1: weth.address,
        tickLower: -100,
        tickUpper: +100,
        amount0Desired: 0,
        amount1Desired: 0,
        amount0Min: 0,
        amount1Min: 0,
        recipient: user.address,
        useAccount: false,
      });
      const _tokenId = tokenId + 1;

      await checkEthBalanceChanges([-25600, 0, 0], [0, 0, 25600], async () => {
        const tx = await manager.multicall(
          [
            manager.interface.encodeFunctionData('addLiquidity', [{ ...baseParams(), tokenId: _tokenId }]),
            manager.interface.encodeFunctionData('refundETH'),
          ],
          { value: 25600 + 10000 },
        );
        const event = await getEvent(tx, hub, 'Mint');
        expect(event.amount0).eq(25600);
        expect(event.amount1).eq(25600);
      });
    });
  });

  context('remove liquidity', () => {
    const tokenId = FIRST_TOKEN_ID;
    const liquidityD8 = 23497;

    beforeEach(async () => {
      await manager.mint({
        tierId: 0,
        token0: token0.address,
        token1: token1.address,
        tickLower: -100,
        tickUpper: +100,
        amount0Desired: 30000,
        amount1Desired: 30000,
        amount0Min: 0,
        amount1Min: 0,
        recipient: user.address,
        useAccount: false,
      });
      expect(await manager.ownerOf(tokenId)).eq(user.address);
      expect((await manager.getPosition(tokenId)).position.liquidityD8).eq(liquidityD8);

      await hub.increaseFeeGrowthGlobal(poolId01, 1e15, 1e15);
    });

    const baseParams = () => {
      return {
        tokenId,
        liquidityD8,
        amount0Min: 0,
        amount1Min: 0,
        withdrawTo: constants.AddressZero,
        collectAllFees: false,
        settled: false,
      };
    };

    it('non-existing token id', async () => {
      await expect(manager.removeLiquidity({ ...baseParams(), tokenId: 123 })).to.be.revertedWith(
        'ERC721: approved query for nonexistent token',
      );
    });

    it('not owner + not approved', async () => {
      // check not approved
      await expect(manager.connect(other).removeLiquidity(baseParams())).to.be.revertedWith('NOT_APPROVED');

      // check approved
      await manager.approve(other.address, tokenId);
      await manager.connect(other).removeLiquidity(baseParams());
    });

    it('not reaching minimum amount', async () => {
      const params = { ...baseParams(), amount0Min: 30000, amount1Min: 30000 };
      await expect(manager.removeLiquidity(params)).to.be.revertedWith('Price slippage');
    });

    it('remove + no withdraw', async () => {
      const reserve0Before = await token0.balanceOf(hub.address);
      const reserve1Before = await token1.balanceOf(hub.address);
      const userBalance0Before = await token0.balanceOf(user.address);
      const userBalance1Before = await token1.balanceOf(user.address);
      const userAccBalance0Before = await getAccBalance(token0.address, user.address);
      const userAccBalance1Before = await getAccBalance(token1.address, user.address);

      const tx = await manager.removeLiquidity(baseParams());

      // check hub event
      const event = await getEvent(tx, hub, 'Burn');
      expect(event.poolId).eq(poolId01);
      expect(event.owner).eq(manager.address);
      expect(event.positionRefId).eq(tokenId);
      expect(event.owner).eq(manager.address);
      expect(event.liquidityD8).eq(liquidityD8);
      expect(event.amount0).gt(0);
      expect(event.amount1).gt(0);
      expect(event.feeAmount0).gt(0);
      expect(event.feeAmount1).gt(0);

      // check balance changes
      const sumAmount0 = event.amount0.add(event.feeAmount0);
      const sumAmount1 = event.amount1.add(event.feeAmount1);
      expect((await token0.balanceOf(hub.address)).sub(reserve0Before)).eq(0);
      expect((await token1.balanceOf(hub.address)).sub(reserve1Before)).eq(0);
      expect((await token0.balanceOf(user.address)).sub(userBalance0Before)).eq(0);
      expect((await token1.balanceOf(user.address)).sub(userBalance1Before)).eq(0);
      expect((await getAccBalance(token0.address, user.address)).sub(userAccBalance0Before)).eq(sumAmount0);
      expect((await getAccBalance(token1.address, user.address)).sub(userAccBalance1Before)).eq(sumAmount1);
    });

    it('remove + withdraw', async () => {
      const reserve0Before = await token0.balanceOf(hub.address);
      const reserve1Before = await token1.balanceOf(hub.address);
      const userBalance0Before = await token0.balanceOf(user.address);
      const userBalance1Before = await token1.balanceOf(user.address);
      const userAccBalance0Before = await getAccBalance(token0.address, user.address);
      const userAccBalance1Before = await getAccBalance(token1.address, user.address);

      const tx = await manager.removeLiquidity({ ...baseParams(), withdrawTo: user.address });

      // check hub event
      const event = await getEvent(tx, hub, 'Burn');
      expect(event.poolId).eq(poolId01);
      expect(event.owner).eq(manager.address);
      expect(event.positionRefId).eq(tokenId);
      expect(event.owner).eq(manager.address);
      expect(event.liquidityD8).eq(liquidityD8);
      expect(event.amount0).gt(0);
      expect(event.amount1).gt(0);
      expect(event.feeAmount0).gt(0);
      expect(event.feeAmount1).gt(0);

      // check balance changes
      const sumAmount0 = event.amount0.add(event.feeAmount0);
      const sumAmount1 = event.amount1.add(event.feeAmount1);
      expect((await token0.balanceOf(hub.address)).sub(reserve0Before)).eq(-sumAmount0);
      expect((await token1.balanceOf(hub.address)).sub(reserve1Before)).eq(-sumAmount1);
      expect((await token0.balanceOf(user.address)).sub(userBalance0Before)).eq(sumAmount0);
      expect((await token1.balanceOf(user.address)).sub(userBalance1Before)).eq(sumAmount1);
      expect((await getAccBalance(token0.address, user.address)).sub(userAccBalance0Before)).eq(0);
      expect((await getAccBalance(token1.address, user.address)).sub(userAccBalance1Before)).eq(0);
    });

    it('eth out (multicall: unwrapWETH)', async () => {
      await manager.mint({
        tierId: 0,
        token0: token2.address,
        token1: weth.address,
        tickLower: -100,
        tickUpper: +100,
        amount0Desired: 30000,
        amount1Desired: 30000,
        amount0Min: 0,
        amount1Min: 0,
        recipient: user.address,
        useAccount: false,
      });
      const _tokenId = tokenId + 1;

      await checkEthBalanceChanges([+29999, 0, 0], [0, 0, -29999], async () => {
        const tx = await manager.multicall([
          manager.interface.encodeFunctionData('removeLiquidity', [
            { ...baseParams(), tokenId: _tokenId, withdrawTo: manager.address },
          ]),
          manager.interface.encodeFunctionData('unwrapWETH', [29999, user.address]),
        ]);
        const event = await getEvent(tx, hub, 'Burn');
        expect(event.amount0).eq(29999);
        expect(event.amount1).eq(29999);
      });
    });
  });

  context('set limit order', () => {
    const tokenId = FIRST_TOKEN_ID;
    const liquidityD8 = 23497;

    beforeEach(async () => {
      await manager.mint({
        tierId: 0,
        token0: token0.address,
        token1: token1.address,
        tickLower: -100,
        tickUpper: +100,
        amount0Desired: 30000,
        amount1Desired: 30000,
        amount0Min: 0,
        amount1Min: 0,
        recipient: user.address,
        useAccount: false,
      });
      await hub.setTierParameters(poolId01, 0, 99850, 200);
      expect(await manager.ownerOf(tokenId)).eq(user.address);
      expect((await manager.getPosition(tokenId)).position.liquidityD8).eq(liquidityD8);
    });

    it('non-existing token id', async () => {
      await expect(manager.setLimitOrderType(123, LimitOrderType.ONE_FOR_ZERO)).to.be.revertedWith(
        'ERC721: approved query for nonexistent token',
      );
    });

    it('not owner + not approved', async () => {
      // check not approved
      await expect(manager.connect(other).setLimitOrderType(tokenId, LimitOrderType.ONE_FOR_ZERO)).to.be.revertedWith(
        'NOT_APPROVED',
      );

      // check approved
      await manager.approve(other.address, tokenId);
      await manager.connect(other).setLimitOrderType(tokenId, LimitOrderType.ONE_FOR_ZERO);
    });

    it('set limit order successfully', async () => {
      await expect(manager.setLimitOrderType(tokenId, LimitOrderType.ONE_FOR_ZERO))
        .to.emit(hub, 'SetLimitOrderType')
        .withArgs(poolId01, manager.address, tokenId, 0, -100, 100, LimitOrderType.ONE_FOR_ZERO);
    });
  });

  context('burn nft', () => {
    const tokenId = FIRST_TOKEN_ID;

    it('non-existing position', async () => {
      await expect(manager.burn([tokenId])).to.be.revertedWith('ERC721: approved query for nonexistent token');
    });

    it('non-empty position', async () => {
      await manager.mint({
        tierId: 0,
        token0: token0.address,
        token1: token1.address,
        tickLower: -100,
        tickUpper: +100,
        amount0Desired: 30000,
        amount1Desired: 30000,
        amount0Min: 0,
        amount1Min: 0,
        recipient: user.address,
        useAccount: false,
      });
      expect(await manager.ownerOf(tokenId)).eq(user.address);
      await expect(manager.burn([tokenId])).to.be.revertedWith('NOT_EMPTY');
    });

    context('empty position', async () => {
      beforeEach(async () => {
        await manager.mint({
          tierId: 0,
          token0: token0.address,
          token1: token1.address,
          tickLower: -100,
          tickUpper: +100,
          amount0Desired: 0, // zero input
          amount1Desired: 0, // zero input
          amount0Min: 0,
          amount1Min: 0,
          recipient: user.address,
          useAccount: false,
        });
      });

      it('not owner + not approved', async () => {
        // check not approved
        await expect(manager.connect(other).burn([tokenId])).to.be.revertedWith('NOT_APPROVED');

        // check approved
        await manager.approve(other.address, tokenId);
        await manager.connect(other).burn([tokenId]);
      });

      it('burn successfully', async () => {
        await manager.burn([tokenId]);
        await expect(manager.ownerOf(tokenId)).to.be.reverted;
        await expect(manager.getPosition(tokenId)).to.be.revertedWith('NOT_EXISTS');
      });
    });
  });
});
