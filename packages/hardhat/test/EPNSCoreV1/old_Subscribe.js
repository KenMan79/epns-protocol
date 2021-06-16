const { ethers } = require("hardhat");
const { use, expect } = require("chai");
const { solidity } = require("ethereum-waffle");
// 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
const {
  advanceBlockTo,
  latestBlock,
  advanceBlock,
  increase,
  increaseTo,
  latest,
} = require("../time");
const { calcChannelFairShare, calcSubscriberFairShare, getPubKey, bn, tokens, tokensBN, bnToInt, ChannelAction, readjustFairShareOfChannels, SubscriberAction, readjustFairShareOfSubscribers } = require("../../helpers/utils");

use(solidity);

describe("EPNSCoreV1 tests", function () {
  const AAVE_LENDING_POOL = "0x1c8756FD2B28e9426CDBDcC7E3c4d64fa9A54728";
  const DAI = "0xf80A32A835F79D7787E8a8ee5721D0fEaFd78108";
  const ADAI = "0xcB1Fe6F440c49E9290c3eb7f158534c2dC374201";
  const referralCode = 0;
  const ADD_CHANNEL_MIN_POOL_CONTRIBUTION = tokensBN(50)
  const ADD_CHANNEL_MAX_POOL_CONTRIBUTION = tokensBN(250000 * 50)
  const DELEGATED_CONTRACT_FEES = ethers.utils.parseEther("0.1");
  const ADJUST_FOR_FLOAT = bn(10 ** 7)
  const delay = 0; // uint for the timelock delay

  const forkAddress = {
    address: "0xe2a6cf5f463df94147a0f0a302c879eb349cb2cd",
  };

  let EPNS;
  let GOVERNOR;
  let PROXYADMIN;
  let LOGIC;
  let LOGICV2;
  let LOGICV3;
  let EPNSProxy;
  let EPNSCoreV1Proxy;
  let TIMELOCK;
  let ADMIN;
  let MOCKDAI;
  let ADAICONTRACT;
  let ALICE;
  let BOB;
  let CHARLIE;
  let CHANNEL_CREATOR;
  let ADMINSIGNER;
  let ALICESIGNER;
  let BOBSIGNER;
  let CHARLIESIGNER;
  let CHANNEL_CREATORSIGNER;
  const ADMIN_OVERRIDE = "";

  const coder = new ethers.utils.AbiCoder();
  // `beforeEach` will run before each test, re-deploying the contract every
  // time. It receives a callback, which can be async.

  before(async function (){
    const MOCKDAITOKEN = await ethers.getContractFactory("MockDAI");
    MOCKDAI = MOCKDAITOKEN.attach(DAI);

    const ADAITOKENS = await ethers.getContractFactory("MockDAI");
    ADAICONTRACT = ADAITOKENS.attach(ADAI);
  });

  beforeEach(async function () {
    // Get the ContractFactory and Signers here.
    const [
      adminSigner,
      aliceSigner,
      bobSigner,
      charlieSigner,
      channelCreatorSigner,
    ] = await ethers.getSigners();

    ADMINSIGNER = adminSigner;
    ALICESIGNER = aliceSigner;
    BOBSIGNER = bobSigner;
    CHARLIESIGNER = charlieSigner;
    CHANNEL_CREATORSIGNER = channelCreatorSigner;

    ADMIN = await adminSigner.getAddress();
    ALICE = await aliceSigner.getAddress();
    BOB = await bobSigner.getAddress();
    CHARLIE = await charlieSigner.getAddress();
    CHANNEL_CREATOR = await channelCreatorSigner.getAddress();

    const EPNSTOKEN = await ethers.getContractFactory("EPNS");
    EPNS = await EPNSTOKEN.deploy();

    const EPNSCoreV1 = await ethers.getContractFactory("EPNSCoreV1");
    LOGIC = await EPNSCoreV1.deploy();

    const TimeLock = await ethers.getContractFactory("Timelock");
    TIMELOCK = await TimeLock.deploy(ADMIN, delay);

    const proxyAdmin = await ethers.getContractFactory("EPNSAdmin");
    PROXYADMIN = await proxyAdmin.deploy();
    await PROXYADMIN.transferOwnership(TIMELOCK.address);

    const EPNSPROXYContract = await ethers.getContractFactory("EPNSProxy");
    EPNSProxy = await EPNSPROXYContract.deploy(
      LOGIC.address,
      ADMINSIGNER.address,
      AAVE_LENDING_POOL,
      DAI,
      ADAI,
      referralCode
    );

    await EPNSProxy.changeAdmin(ALICESIGNER.address);
    EPNSCoreV1Proxy = EPNSCoreV1.attach(EPNSProxy.address)
  });

  afterEach(function () {
    EPNS = null
    LOGIC = null
    TIMELOCK = null
    EPNSProxy = null
    EPNSCoreV1Proxy = null
  });

  describe("Testing subscribe realted functions", function(){
    describe("Testing subscribeDelegated", function(){
      const CHANNEL_TYPE = 2;
      const testChannel = ethers.utils.toUtf8Bytes("test-channel-hello-world");
  
      beforeEach(async function(){
        await EPNSCoreV1Proxy.connect(ADMINSIGNER).addToChannelizationWhitelist(CHANNEL_CREATOR, {gasLimit: 500000});
      
        await MOCKDAI.connect(CHANNEL_CREATORSIGNER).mint(ADD_CHANNEL_MIN_POOL_CONTRIBUTION);
        await MOCKDAI.connect(CHANNEL_CREATORSIGNER).approve(EPNSCoreV1Proxy.address, ADD_CHANNEL_MIN_POOL_CONTRIBUTION);
        await EPNSCoreV1Proxy.connect(CHANNEL_CREATORSIGNER).createChannelWithFees(CHANNEL_TYPE, testChannel, {gasLimit: 2000000});

        await MOCKDAI.connect(CHANNEL_CREATORSIGNER).mint(DELEGATED_CONTRACT_FEES);
        await MOCKDAI.connect(CHANNEL_CREATORSIGNER).approve(EPNSCoreV1Proxy.address, DELEGATED_CONTRACT_FEES);
      })
  
      it("should revert subscribe if channels are deactivated", async function () {
        await EPNSCoreV1Proxy.connect(CHANNEL_CREATORSIGNER).deactivateChannel();
        
        const tx = EPNSCoreV1Proxy.connect(CHANNEL_CREATORSIGNER).subscribeDelegated(CHANNEL_CREATOR, BOB);
        await expect(tx).to.be.revertedWith("Channel deactivated or doesn't exists");
      });

      it("should revert subscribe if channels are graylisted", async function () {
        await EPNSCoreV1Proxy.connect(BOBSIGNER).subscribe(CHANNEL_CREATOR);
        await EPNSCoreV1Proxy.connect(BOBSIGNER).unsubscribe(CHANNEL_CREATOR);
        
        const tx = EPNSCoreV1Proxy.connect(CHANNEL_CREATORSIGNER).subscribeDelegated(CHANNEL_CREATOR, BOB);
        await expect(tx).to.be.revertedWith("Channel is graylisted");
      });

      // it("should deduct delegation fees from user wallet", async function () {
      //   const channelCreatorDAIBalanceBefore = await MOCKDAI.balanceOf(CHANNEL_CREATOR);
  
  
      //   const ownerDaiFundsBefore = await EPNSCoreV1Proxy.ownerDaiFunds();

      //   await EPNSCoreV1Proxy.connect(CHANNEL_CREATORSIGNER).subscribeDelegated(CHANNEL_CREATOR, BOB);
        
      //   const userSubscribed = await EPNSCoreV1Proxy.memberExists(BOB, CHANNEL_CREATOR);
      //   expect(userSubscribed).to.equal(true);

      //   const channelCreatorDAIBalanceAfter = await MOCKDAI.balanceOf(CHANNEL_CREATOR);
  
  
      //   const ownerDaiFundsAfter = await EPNSCoreV1Proxy.ownerDaiFunds();
  
  
  
      //   expect(channelCreatorDAIBalanceAfter).to.equal(channelCreatorDAIBalanceBefore.sub(DELEGATED_CONTRACT_FEES));
      //   expect(ownerDaiFundsAfter).to.equal(ownerDaiFundsBefore.add(DELEGATED_CONTRACT_FEES));
      // });

      it("should revert if already subscribed", async function () {
        await EPNSCoreV1Proxy.connect(BOBSIGNER).subscribe(CHANNEL_CREATOR);
        const tx = EPNSCoreV1Proxy.connect(CHANNEL_CREATORSIGNER).subscribeDelegated(CHANNEL_CREATOR, BOB);
        
        await expect(tx).to.be.revertedWith("Subscriber already Exists");
      });

      it("Should add user to epns contract when subscribing if new user", async function(){
        const usersCountBefore = await EPNSCoreV1Proxy.usersCount()
        const tx = await EPNSCoreV1Proxy.connect(CHANNEL_CREATORSIGNER).subscribeDelegated(CHANNEL_CREATOR, BOB);
        
        const user = await EPNSCoreV1Proxy.users(BOB);
        const usersCountAfter = await EPNSCoreV1Proxy.usersCount()

        expect(user.userStartBlock).to.equal(tx.blockNumber);
        expect(user.userActivated).to.equal(true);

        expect(usersCountBefore.add(1)).to.equal(usersCountAfter);
      });

      it("should subscribe and change revelant details", async function () {
        const userBefore = await EPNSCoreV1Proxy.users(BOB);
        const channelBefore = await EPNSCoreV1Proxy.channels(CHANNEL_CREATOR);

        await EPNSCoreV1Proxy.connect(CHANNEL_CREATORSIGNER).subscribeDelegated(CHANNEL_CREATOR, BOB);

        const userAfter = await EPNSCoreV1Proxy.users(BOB);
        const channelAfter = await EPNSCoreV1Proxy.channels(CHANNEL_CREATOR);

        expect(userAfter.subscribedCount).to.equal(userBefore.subscribedCount.add(1))
        expect(channelAfter.memberCount).to.equal(channelBefore.memberCount.add(1))
      });

      it("should subscribe and update fair share values", async function(){
        const channel = await EPNSCoreV1Proxy.channels(CHANNEL_CREATOR);

        const _channelFairShareCount = channel.channelFairShareCount;
        const _channelHistoricalZ = channel.channelHistoricalZ;
        const _channelLastUpdate = channel.channelLastUpdate;
        
        const tx = await EPNSCoreV1Proxy.connect(CHANNEL_CREATORSIGNER).subscribeDelegated(CHANNEL_CREATOR, BOB);
        const blockNumber = tx.blockNumber;
        
        const { 
          channelNewFairShareCount, 
          channelNewHistoricalZ, 
          channelNewLastUpdate, 
        } = readjustFairShareOfSubscribers(SubscriberAction.SubscriberAdded, _channelFairShareCount, _channelHistoricalZ, _channelLastUpdate, bn(blockNumber));
        
        const channelNew = await EPNSCoreV1Proxy.channels(CHANNEL_CREATOR);

        const _channelNewFairShareCountNew = channelNew.channelFairShareCount;
        const _channelHistoricalZNew = channelNew.channelHistoricalZ;
        const _channelLastUpdateNew = channelNew.channelLastUpdate;
        
        expect(_channelNewFairShareCountNew).to.equal(channelNewFairShareCount);
        expect(_channelHistoricalZNew).to.equal(channelNewHistoricalZ);
        expect(_channelLastUpdateNew).to.equal(channelNewLastUpdate);
      });

      it("should subscribe and emit Subscribe event", async function () {
        const tx = await EPNSCoreV1Proxy.connect(CHANNEL_CREATORSIGNER).subscribeDelegated(CHANNEL_CREATOR, BOB);

        await expect(tx)
          .to.emit(EPNSCoreV1Proxy, 'Subscribe')
          .withArgs(CHANNEL_CREATOR, BOB)
      });
    });
    
    describe("Testing subscribeWithPublicKeyDelegated", function(){
      const CHANNEL_TYPE = 2;
      const testChannel = ethers.utils.toUtf8Bytes("test-channel-hello-world");
  
      beforeEach(async function(){
        await EPNSCoreV1Proxy.connect(ADMINSIGNER).addToChannelizationWhitelist(CHANNEL_CREATOR, {gasLimit: 500000});
      
        await MOCKDAI.connect(CHANNEL_CREATORSIGNER).mint(ADD_CHANNEL_MIN_POOL_CONTRIBUTION);
        await MOCKDAI.connect(CHANNEL_CREATORSIGNER).approve(EPNSCoreV1Proxy.address, ADD_CHANNEL_MIN_POOL_CONTRIBUTION);
        await EPNSCoreV1Proxy.connect(CHANNEL_CREATORSIGNER).createChannelWithFees(CHANNEL_TYPE, testChannel, {gasLimit: 2000000});

        await MOCKDAI.connect(CHANNEL_CREATORSIGNER).mint(DELEGATED_CONTRACT_FEES);
        await MOCKDAI.connect(CHANNEL_CREATORSIGNER).approve(EPNSCoreV1Proxy.address, DELEGATED_CONTRACT_FEES);
      })
  
      it("should revert subscribe if channels are deactivated", async function () {
        await EPNSCoreV1Proxy.connect(CHANNEL_CREATORSIGNER).deactivateChannel();
        const publicKey = await getPubKey(CHANNEL_CREATORSIGNER)
        
        const tx = EPNSCoreV1Proxy.connect(CHANNEL_CREATORSIGNER).subscribeWithPublicKeyDelegated(CHANNEL_CREATOR, BOB, publicKey.slice(1));
        await expect(tx).to.be.revertedWith("Channel deactivated or doesn't exists");
      });

      it("should revert subscribe if channels are graylisted", async function () {
        await EPNSCoreV1Proxy.connect(BOBSIGNER).subscribe(CHANNEL_CREATOR);
        await EPNSCoreV1Proxy.connect(BOBSIGNER).unsubscribe(CHANNEL_CREATOR);
        
        const publicKey = await getPubKey(CHANNEL_CREATORSIGNER)
        
        const tx = EPNSCoreV1Proxy.connect(CHANNEL_CREATORSIGNER).subscribeWithPublicKeyDelegated(CHANNEL_CREATOR, BOB, publicKey.slice(1));
        await expect(tx).to.be.revertedWith("Channel is graylisted");
      });

      // it("should deduct delegation fees from user wallet", async function () {
      //   const channelCreatorDAIBalanceBefore = await MOCKDAI.balanceOf(CHANNEL_CREATOR);
  
  
      //   const ownerDaiFundsBefore = await EPNSCoreV1Proxy.ownerDaiFunds();

      //   const publicKey = await getPubKey(CHANNEL_CREATORSIGNER)
        
      //   const tx = EPNSCoreV1Proxy.connect(CHANNEL_CREATORSIGNER).subscribeWithPublicKeyDelegated(CHANNEL_CREATOR, BOB, publicKey.slice(1));
        
      //   const userSubscribed = await EPNSCoreV1Proxy.memberExists(BOB, CHANNEL_CREATOR);
      //   expect(userSubscribed).to.equal(true);

      //   const channelCreatorDAIBalanceAfter = await MOCKDAI.balanceOf(CHANNEL_CREATOR);
  
  
      //   const ownerDaiFundsAfter = await EPNSCoreV1Proxy.ownerDaiFunds();
  
  
  
      //   expect(channelCreatorDAIBalanceAfter).to.equal(channelCreatorDAIBalanceBefore.sub(DELEGATED_CONTRACT_FEES));
      //   expect(ownerDaiFundsAfter).to.equal(ownerDaiFundsBefore.add(DELEGATED_CONTRACT_FEES));
      // });

      it("should revert if already subscribed", async function () {
        await EPNSCoreV1Proxy.connect(BOBSIGNER).subscribe(CHANNEL_CREATOR);
        const publicKey = await getPubKey(CHANNEL_CREATORSIGNER)
        
        const tx = EPNSCoreV1Proxy.connect(CHANNEL_CREATORSIGNER).subscribeWithPublicKeyDelegated(CHANNEL_CREATOR, BOB, publicKey.slice(1));
        
        await expect(tx).to.be11.revertedWith("Subscriber already Exists");
      });

      it("Should add user to epns contract when subscribing if new user", async function(){
        const usersCountBefore = await EPNSCoreV1Proxy.usersCount()
        
        const publicKey = await getPubKey(CHANNEL_CREATORSIGNER)
        
        const tx = await EPNSCoreV1Proxy.connect(CHANNEL_CREATORSIGNER).subscribeWithPublicKeyDelegated(CHANNEL_CREATOR, BOB, publicKey.slice(1));
        
        const user = await EPNSCoreV1Proxy.users(BOB);
        const usersCountAfter = await EPNSCoreV1Proxy.usersCount()

        expect(user.userStartBlock).to.equal(tx.blockNumber);
        expect(user.userActivated).to.equal(true);

        expect(usersCountBefore.add(1)).to.equal(usersCountAfter);
      });

      it("Should broadcast user public key when subscribing to channel", async function(){
        const CHANNEL_TYPE = 2;
        await EPNSCoreV1Proxy.connect(ADMINSIGNER).addToChannelizationWhitelist(CHANNEL_CREATOR, {gasLimit: 500000});
        
        const testChannel = ethers.utils.toUtf8Bytes("test-channel-hello-world");        

        await MOCKDAI.connect(CHANNEL_CREATORSIGNER).mint(ADD_CHANNEL_MIN_POOL_CONTRIBUTION);
        await MOCKDAI.connect(CHANNEL_CREATORSIGNER).approve(EPNSCoreV1Proxy.address, ADD_CHANNEL_MIN_POOL_CONTRIBUTION);

        const publicKey = await getPubKey(CHANNEL_CREATORSIGNER)
        const tx = await EPNSCoreV1Proxy.connect(CHANNEL_CREATORSIGNER).subscribeWithPublicKeyDelegated(CHANNEL_CREATOR, BOB, publicKey.slice(1), {gasLimit: 2000000});
        const user = await EPNSCoreV1Proxy.users(CHANNEL_CREATOR)

        expect(user.publicKeyRegistered).to.equal(true);
      });

      it("should emit PublicKeyRegistered event when user public key is not registered", async function(){
        const publicKey = await getPubKey(CHANNEL_CREATORSIGNER)
        const tx = EPNSCoreV1Proxy.connect(CHANNEL_CREATORSIGNER).subscribeWithPublicKeyDelegated(CHANNEL_CREATOR, BOB, publicKey.slice(1), {gasLimit: 2000000});

        await expect(tx)
          .to.emit(EPNSCoreV1Proxy, 'PublicKeyRegistered')
          .withArgs(CHANNEL_CREATOR, ethers.utils.hexlify(publicKey.slice(1)))
      });

      it("Should not broadcast user public key twice", async function(){
        const publicKey = await getPubKey(BOBSIGNER)
        await EPNSCoreV1Proxy.connect(BOBSIGNER).broadcastUserPublicKey(publicKey.slice(1));
        const tx = EPNSCoreV1Proxy.connect(CHANNEL_CREATORSIGNER).subscribeWithPublicKeyDelegated(CHANNEL_CREATOR, BOB, publicKey.slice(1), {gasLimit: 2000000});

        await expect(tx)
          .to.not.emit(EPNSCoreV1Proxy, 'PublicKeyRegistered')
          .withArgs(CHANNEL_CREATOR, ethers.utils.hexlify(publicKey.slice(1)))
      });

      it("Should revert if broadcast user public does not match with sender address", async function(){
        const publicKey = await getPubKey(BOBSIGNER)
        const tx = EPNSCoreV1Proxy.connect(CHANNEL_CREATORSIGNER).subscribeWithPublicKeyDelegated(CHANNEL_CREATOR, BOB, publicKey.slice(1), {gasLimit: 2000000});

        await expect(tx).to.be.revertedWith("Public Key Validation Failed")
      });

      it("should subscribe and change revelant details", async function () {
        const userBefore = await EPNSCoreV1Proxy.users(BOB);
        const channelBefore = await EPNSCoreV1Proxy.channels(CHANNEL_CREATOR);

        const publicKey = await getPubKey(CHANNEL_CREATORSIGNER)
        
        await EPNSCoreV1Proxy.connect(CHANNEL_CREATORSIGNER).subscribeWithPublicKeyDelegated(CHANNEL_CREATOR, BOB, publicKey.slice(1));

        const userAfter = await EPNSCoreV1Proxy.users(BOB);
        const channelAfter = await EPNSCoreV1Proxy.channels(CHANNEL_CREATOR);

        expect(userAfter.subscribedCount).to.equal(userBefore.subscribedCount.add(1))
        expect(channelAfter.memberCount).to.equal(channelBefore.memberCount.add(1))
      });

      it("should subscribe and update fair share values", async function(){
        const channel = await EPNSCoreV1Proxy.channels(CHANNEL_CREATOR);

        const _channelFairShareCount = channel.channelFairShareCount;
        const _channelHistoricalZ = channel.channelHistoricalZ;
        const _channelLastUpdate = channel.channelLastUpdate;
        
        const publicKey = await getPubKey(CHANNEL_CREATORSIGNER)
        const tx = await EPNSCoreV1Proxy.connect(CHANNEL_CREATORSIGNER).subscribeWithPublicKeyDelegated(CHANNEL_CREATOR, BOB, publicKey.slice(1));
        const blockNumber = tx.blockNumber;
        
        const { 
          channelNewFairShareCount, 
          channelNewHistoricalZ, 
          channelNewLastUpdate, 
        } = readjustFairShareOfSubscribers(SubscriberAction.SubscriberAdded, _channelFairShareCount, _channelHistoricalZ, _channelLastUpdate, bn(blockNumber));
        
        const channelNew = await EPNSCoreV1Proxy.channels(CHANNEL_CREATOR);

        const _channelNewFairShareCountNew = channelNew.channelFairShareCount;
        const _channelHistoricalZNew = channelNew.channelHistoricalZ;
        const _channelLastUpdateNew = channelNew.channelLastUpdate;
        
        expect(_channelNewFairShareCountNew).to.equal(channelNewFairShareCount);
        expect(_channelHistoricalZNew).to.equal(channelNewHistoricalZ);
        expect(_channelLastUpdateNew).to.equal(channelNewLastUpdate);
      });

      it("should subscribe and emit Subscribe event", async function () {
        const publicKey = await getPubKey(CHANNEL_CREATORSIGNER)
        
        const tx = EPNSCoreV1Proxy.connect(CHANNEL_CREATORSIGNER).subscribeWithPublicKeyDelegated(CHANNEL_CREATOR, BOB, publicKey.slice(1));

        await expect(tx)
          .to.emit(EPNSCoreV1Proxy, 'Subscribe')
          .withArgs(CHANNEL_CREATOR, BOB)
      });
    });

    describe("Testing subscribeWithPublicKey", function(){
      const CHANNEL_TYPE = 2;
      const testChannel = ethers.utils.toUtf8Bytes("test-channel-hello-world");
  
      beforeEach(async function(){
        await EPNSCoreV1Proxy.connect(ADMINSIGNER).addToChannelizationWhitelist(CHANNEL_CREATOR, {gasLimit: 500000});
      
        await MOCKDAI.connect(CHANNEL_CREATORSIGNER).mint(ADD_CHANNEL_MIN_POOL_CONTRIBUTION);
        await MOCKDAI.connect(CHANNEL_CREATORSIGNER).approve(EPNSCoreV1Proxy.address, ADD_CHANNEL_MIN_POOL_CONTRIBUTION);
        await EPNSCoreV1Proxy.connect(CHANNEL_CREATORSIGNER).createChannelWithFees(CHANNEL_TYPE, testChannel, {gasLimit: 2000000});
      })
  
      it("should revert subscribe if channels are deactivated", async function () {
        await EPNSCoreV1Proxy.connect(CHANNEL_CREATORSIGNER).deactivateChannel();
        const publicKey = await getPubKey(BOBSIGNER)
        
        const tx = EPNSCoreV1Proxy.connect(BOBSIGNER).subscribeWithPublicKey(CHANNEL_CREATOR, publicKey.slice(1));
        await expect(tx).to.be.revertedWith("Channel deactivated or doesn't exists");
      });

      // it("should deduct delegation fees from user wallet", async function () {
      //   const channelCreatorDAIBalanceBefore = await MOCKDAI.balanceOf(CHANNEL_CREATOR);
  
  
      //   const ownerDaiFundsBefore = await EPNSCoreV1Proxy.ownerDaiFunds();

      //   const publicKey = await getPubKey(BOBSIGNER)
        
      //   const tx = EPNSCoreV1Proxy.connect(BOBSIGNER).subscribeWithPublicKey(CHANNEL_CREATOR, publicKey.slice(1));
        
      //   const userSubscribed = await EPNSCoreV1Proxy.memberExists(BOB, CHANNEL_CREATOR);
      //   expect(userSubscribed).to.equal(true);

      //   const channelCreatorDAIBalanceAfter = await MOCKDAI.balanceOf(CHANNEL_CREATOR);
  
  
      //   const ownerDaiFundsAfter = await EPNSCoreV1Proxy.ownerDaiFunds();
  
  
  
      //   expect(channelCreatorDAIBalanceAfter).to.equal(channelCreatorDAIBalanceBefore.sub(DELEGATED_CONTRACT_FEES));
      //   expect(ownerDaiFundsAfter).to.equal(ownerDaiFundsBefore.add(DELEGATED_CONTRACT_FEES));
      // });

      it("should revert if already subscribed", async function () {
        await EPNSCoreV1Proxy.connect(BOBSIGNER).subscribe(CHANNEL_CREATOR);
        const publicKey = await getPubKey(BOBSIGNER)
        
        const tx = EPNSCoreV1Proxy.connect(BOBSIGNER).subscribeWithPublicKey(CHANNEL_CREATOR, publicKey.slice(1));
        
        await expect(tx).to.be.revertedWith("Subscriber already Exists");
      });

      it("Should add user to epns contract when subscribing if new user", async function(){
        const usersCountBefore = await EPNSCoreV1Proxy.usersCount()
        
        const publicKey = await getPubKey(BOBSIGNER)
        
        const tx = await EPNSCoreV1Proxy.connect(BOBSIGNER).subscribeWithPublicKey(CHANNEL_CREATOR, publicKey.slice(1));
        
        const user = await EPNSCoreV1Proxy.users(BOB);
        const usersCountAfter = await EPNSCoreV1Proxy.usersCount()

        expect(user.userStartBlock).to.equal(tx.blockNumber);
        expect(user.userActivated).to.equal(true);

        expect(usersCountBefore.add(1)).to.equal(usersCountAfter);
      });

      it("Should broadcast user public key when subscribing to channel", async function(){
        const publicKey = await getPubKey(BOBSIGNER)
        await EPNSCoreV1Proxy.connect(BOBSIGNER).subscribeWithPublicKey(CHANNEL_CREATOR, publicKey.slice(1));
        const user = await EPNSCoreV1Proxy.users(BOB)

        expect(user.publicKeyRegistered).to.equal(true);
      });

      it("should emit PublicKeyRegistered event when user public key is not registered", async function(){
        const publicKey = await getPubKey(BOBSIGNER)
        const tx = EPNSCoreV1Proxy.connect(BOBSIGNER).subscribeWithPublicKey(CHANNEL_CREATOR, publicKey.slice(1));

        await expect(tx)
          .to.emit(EPNSCoreV1Proxy, 'PublicKeyRegistered')
          .withArgs(BOB, ethers.utils.hexlify(publicKey.slice(1)))
      });

      it("Should not broadcast user public key twice", async function(){
        const publicKey = await getPubKey(BOBSIGNER)
        await EPNSCoreV1Proxy.connect(BOBSIGNER).broadcastUserPublicKey(publicKey.slice(1));
        const tx = EPNSCoreV1Proxy.connect(BOBSIGNER).subscribeWithPublicKey(CHANNEL_CREATOR, publicKey.slice(1));

        await expect(tx)
          .to.not.emit(EPNSCoreV1Proxy, 'PublicKeyRegistered')
          .withArgs(BOB, ethers.utils.hexlify(publicKey.slice(1)))
      });

      it("Should revert if broadcast user public does not match with sender address", async function(){
        const publicKey = await getPubKey(CHANNEL_CREATORSIGNER)
        const tx = EPNSCoreV1Proxy.connect(BOBSIGNER).subscribeWithPublicKey(CHANNEL_CREATOR, publicKey.slice(1));

        await expect(tx).to.be.revertedWith("Public Key Validation Failed")
      });

      it("should subscribe and change revelant details", async function () {
        const userBefore = await EPNSCoreV1Proxy.users(BOB);
        const channelBefore = await EPNSCoreV1Proxy.channels(CHANNEL_CREATOR);

        const publicKey = await getPubKey(BOBSIGNER)
        await EPNSCoreV1Proxy.connect(BOBSIGNER).subscribeWithPublicKey(CHANNEL_CREATOR, publicKey.slice(1));

        const userAfter = await EPNSCoreV1Proxy.users(BOB);
        const channelAfter = await EPNSCoreV1Proxy.channels(CHANNEL_CREATOR);

        expect(userAfter.subscribedCount).to.equal(userBefore.subscribedCount.add(1))
        expect(channelAfter.memberCount).to.equal(channelBefore.memberCount.add(1))
      });

      it("should subscribe and update fair share values", async function(){
        const channel = await EPNSCoreV1Proxy.channels(CHANNEL_CREATOR);

        const _channelFairShareCount = channel.channelFairShareCount;
        const _channelHistoricalZ = channel.channelHistoricalZ;
        const _channelLastUpdate = channel.channelLastUpdate;
        
        const publicKey = await getPubKey(BOBSIGNER)
        const tx = await EPNSCoreV1Proxy.connect(BOBSIGNER).subscribeWithPublicKey(CHANNEL_CREATOR, publicKey.slice(1));
        const blockNumber = tx.blockNumber;
        
        const { 
          channelNewFairShareCount, 
          channelNewHistoricalZ, 
          channelNewLastUpdate, 
        } = readjustFairShareOfSubscribers(SubscriberAction.SubscriberAdded, _channelFairShareCount, _channelHistoricalZ, _channelLastUpdate, bn(blockNumber));
        
        const channelNew = await EPNSCoreV1Proxy.channels(CHANNEL_CREATOR);

        const _channelNewFairShareCountNew = channelNew.channelFairShareCount;
        const _channelHistoricalZNew = channelNew.channelHistoricalZ;
        const _channelLastUpdateNew = channelNew.channelLastUpdate;
        
        expect(_channelNewFairShareCountNew).to.equal(channelNewFairShareCount);
        expect(_channelHistoricalZNew).to.equal(channelNewHistoricalZ);
        expect(_channelLastUpdateNew).to.equal(channelNewLastUpdate);
      });

      it("should subscribe and emit Subscribe event", async function () {
        const publicKey = await getPubKey(BOBSIGNER)
        
        const tx = EPNSCoreV1Proxy.connect(BOBSIGNER).subscribeWithPublicKey(CHANNEL_CREATOR, publicKey.slice(1));

        await expect(tx)
          .to.emit(EPNSCoreV1Proxy, 'Subscribe')
          .withArgs(CHANNEL_CREATOR, BOB)
      });
    });
    
    describe("Testing subscribe", function(){
      const CHANNEL_TYPE = 2;
      const testChannel = ethers.utils.toUtf8Bytes("test-channel-hello-world");
  
      beforeEach(async function(){
        await EPNSCoreV1Proxy.connect(ADMINSIGNER).addToChannelizationWhitelist(CHANNEL_CREATOR, {gasLimit: 500000});
      
        await MOCKDAI.connect(CHANNEL_CREATORSIGNER).mint(ADD_CHANNEL_MIN_POOL_CONTRIBUTION);
        await MOCKDAI.connect(CHANNEL_CREATORSIGNER).approve(EPNSCoreV1Proxy.address, ADD_CHANNEL_MIN_POOL_CONTRIBUTION);
        await EPNSCoreV1Proxy.connect(CHANNEL_CREATORSIGNER).createChannelWithFees(CHANNEL_TYPE, testChannel, {gasLimit: 2000000});
      })
  
      it("should revert subscribe if channels are deactivated", async function () {
        await EPNSCoreV1Proxy.connect(CHANNEL_CREATORSIGNER).deactivateChannel();
        
        const tx = EPNSCoreV1Proxy.connect(BOBSIGNER).subscribe(CHANNEL_CREATOR);
        await expect(tx).to.be.revertedWith("Channel deactivated or doesn't exists");
      });

      // it("should deduct delegation fees from user wallet", async function () {
      //   const channelCreatorDAIBalanceBefore = await MOCKDAI.balanceOf(CHANNEL_CREATOR);
  
  
      //   const ownerDaiFundsBefore = await EPNSCoreV1Proxy.ownerDaiFunds();

      //   const publicKey = await getPubKey(BOBSIGNER)
        
      //   const tx = EPNSCoreV1Proxy.connect(BOBSIGNER).subscribe(CHANNEL_CREATOR);
        
      //   const userSubscribed = await EPNSCoreV1Proxy.memberExists(BOB, CHANNEL_CREATOR);
      //   expect(userSubscribed).to.equal(true);

      //   const channelCreatorDAIBalanceAfter = await MOCKDAI.balanceOf(CHANNEL_CREATOR);
  
  
      //   const ownerDaiFundsAfter = await EPNSCoreV1Proxy.ownerDaiFunds();
  
  
  
      //   expect(channelCreatorDAIBalanceAfter).to.equal(channelCreatorDAIBalanceBefore.sub(DELEGATED_CONTRACT_FEES));
      //   expect(ownerDaiFundsAfter).to.equal(ownerDaiFundsBefore.add(DELEGATED_CONTRACT_FEES));
      // });

      it("should revert if already subscribed", async function () {
        await EPNSCoreV1Proxy.connect(BOBSIGNER).subscribe(CHANNEL_CREATOR);
        
        const tx = EPNSCoreV1Proxy.connect(BOBSIGNER).subscribe(CHANNEL_CREATOR);
        
        await expect(tx).to.be.revertedWith("Subscriber already Exists");
      });

      it("Should add user to epns contract when subscribing if new user", async function(){
        const usersCountBefore = await EPNSCoreV1Proxy.usersCount()
        
        const tx = await EPNSCoreV1Proxy.connect(BOBSIGNER).subscribe(CHANNEL_CREATOR);
        
        const user = await EPNSCoreV1Proxy.users(BOB);
        const usersCountAfter = await EPNSCoreV1Proxy.usersCount()

        expect(user.userStartBlock).to.equal(tx.blockNumber);
        expect(user.userActivated).to.equal(true);

        expect(usersCountBefore.add(1)).to.equal(usersCountAfter);
      });

      it("should subscribe and change revelant details", async function () {
        const userBefore = await EPNSCoreV1Proxy.users(BOB);
        const channelBefore = await EPNSCoreV1Proxy.channels(CHANNEL_CREATOR);

        await EPNSCoreV1Proxy.connect(BOBSIGNER).subscribe(CHANNEL_CREATOR);

        const userAfter = await EPNSCoreV1Proxy.users(BOB);
        const channelAfter = await EPNSCoreV1Proxy.channels(CHANNEL_CREATOR);

        expect(userAfter.subscribedCount).to.equal(userBefore.subscribedCount.add(1))
        expect(channelAfter.memberCount).to.equal(channelBefore.memberCount.add(1))
      });

      it("should subscribe and update fair share values", async function(){
        const channel = await EPNSCoreV1Proxy.channels(CHANNEL_CREATOR);

        const _channelFairShareCount = channel.channelFairShareCount;
        const _channelHistoricalZ = channel.channelHistoricalZ;
        const _channelLastUpdate = channel.channelLastUpdate;
        
        const tx = await EPNSCoreV1Proxy.connect(BOBSIGNER).subscribe(CHANNEL_CREATOR);
        const blockNumber = tx.blockNumber;
        
        const { 
          channelNewFairShareCount, 
          channelNewHistoricalZ, 
          channelNewLastUpdate, 
        } = readjustFairShareOfSubscribers(SubscriberAction.SubscriberAdded, _channelFairShareCount, _channelHistoricalZ, _channelLastUpdate, bn(blockNumber));
        
        const channelNew = await EPNSCoreV1Proxy.channels(CHANNEL_CREATOR);

        const _channelNewFairShareCountNew = channelNew.channelFairShareCount;
        const _channelHistoricalZNew = channelNew.channelHistoricalZ;
        const _channelLastUpdateNew = channelNew.channelLastUpdate;
        
        expect(_channelNewFairShareCountNew).to.equal(channelNewFairShareCount);
        expect(_channelHistoricalZNew).to.equal(channelNewHistoricalZ);
        expect(_channelLastUpdateNew).to.equal(channelNewLastUpdate);
      });

      it("should subscribe and emit Subscribe event", async function () {
        const tx = EPNSCoreV1Proxy.connect(BOBSIGNER).subscribe(CHANNEL_CREATOR);

        await expect(tx)
          .to.emit(EPNSCoreV1Proxy, 'Subscribe')
          .withArgs(CHANNEL_CREATOR, BOB)
      });
    });

    describe("Testing unsubscribe", function(){
      const CHANNEL_TYPE = 2;
      const testChannel = ethers.utils.toUtf8Bytes("test-channel-hello-world");
  
      beforeEach(async function(){
        await EPNSCoreV1Proxy.connect(ADMINSIGNER).addToChannelizationWhitelist(CHANNEL_CREATOR, {gasLimit: 500000});
      
        await MOCKDAI.connect(CHANNEL_CREATORSIGNER).mint(ADD_CHANNEL_MIN_POOL_CONTRIBUTION);
        await MOCKDAI.connect(CHANNEL_CREATORSIGNER).approve(EPNSCoreV1Proxy.address, ADD_CHANNEL_MIN_POOL_CONTRIBUTION);
        await EPNSCoreV1Proxy.connect(CHANNEL_CREATORSIGNER).createChannelWithFees(CHANNEL_TYPE, testChannel, {gasLimit: 2000000});
      })
  
      it("should revert subscribe if channel doesn't exist", async function () {
        const tx = EPNSCoreV1Proxy.connect(BOBSIGNER).unsubscribe(BOB);
        await expect(tx).to.be.revertedWith("Channel doesn't Exists");
      });

      it("should revert subscribe if owner tries to unsubscribe", async function () {
        const tx = EPNSCoreV1Proxy.connect(CHANNEL_CREATORSIGNER).unsubscribe(CHANNEL_CREATOR);
        await expect(tx).to.be.revertedWith("Either Channel Owner or Not Subscribed");
      });

      it("should revert subscribe if  not already subscribed", async function () {
        const tx = EPNSCoreV1Proxy.connect(BOBSIGNER).unsubscribe(CHANNEL_CREATOR);
        await expect(tx).to.be.revertedWith("Either Channel Owner or Not Subscribed");
      });

      it("should unsubscribe and change revelant details", async function () {
        await EPNSCoreV1Proxy.connect(BOBSIGNER).subscribe(CHANNEL_CREATOR);
        const userBefore = await EPNSCoreV1Proxy.users(BOB);
        const channelBefore = await EPNSCoreV1Proxy.channels(CHANNEL_CREATOR);
        await EPNSCoreV1Proxy.connect(BOBSIGNER).unsubscribe(CHANNEL_CREATOR);

        const userAfter = await EPNSCoreV1Proxy.users(BOB);
        const channelAfter = await EPNSCoreV1Proxy.channels(CHANNEL_CREATOR);

        expect(userAfter.subscribedCount).to.equal(userBefore.subscribedCount.sub(1))
        expect(channelAfter.memberCount).to.equal(channelBefore.memberCount.sub(1))
      });

      it("should subscribe and update fair share values", async function(){
        const publicKey = await getPubKey(BOBSIGNER);
        await EPNSCoreV1Proxy.connect(BOBSIGNER).subscribeWithPublicKey(CHANNEL_CREATOR, publicKey.slice(1));
        const channel = await EPNSCoreV1Proxy.channels(CHANNEL_CREATOR);

        const _channelFairShareCount = channel.channelFairShareCount;
        const _channelHistoricalZ = channel.channelHistoricalZ;
        const _channelLastUpdate = channel.channelLastUpdate;
      
        const tx = await EPNSCoreV1Proxy.connect(BOBSIGNER).unsubscribe(CHANNEL_CREATOR);
        const blockNumber = tx.blockNumber;
        
        const { 
          channelNewFairShareCount, 
          channelNewHistoricalZ, 
          channelNewLastUpdate, 
        } = readjustFairShareOfSubscribers(SubscriberAction.SubscriberRemoved, _channelFairShareCount, _channelHistoricalZ, _channelLastUpdate, bn(blockNumber));
        
        const channelNew = await EPNSCoreV1Proxy.channels(CHANNEL_CREATOR);

        const _channelNewFairShareCountNew = channelNew.channelFairShareCount;
        const _channelHistoricalZNew = channelNew.channelHistoricalZ;
        const _channelLastUpdateNew = channelNew.channelLastUpdate;
        
        expect(_channelNewFairShareCountNew).to.equal(channelNewFairShareCount);
        expect(_channelHistoricalZNew).to.equal(channelNewHistoricalZ);
        expect(_channelLastUpdateNew).to.equal(channelNewLastUpdate);
      });

      it("should unsubscribe and emit Unsubscribe event", async function () {
        await EPNSCoreV1Proxy.connect(BOBSIGNER).subscribe(CHANNEL_CREATOR);
        const tx = EPNSCoreV1Proxy.connect(BOBSIGNER).unsubscribe(CHANNEL_CREATOR);

        await expect(tx)
          .to.emit(EPNSCoreV1Proxy, 'Unsubscribe')
          .withArgs(CHANNEL_CREATOR, BOB)
      });
    });
  });
});