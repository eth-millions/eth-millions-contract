export interface EuroMillionsContract {
  address: string;
  buyTicket(mainNumbers: number[], luckyStars: number[], options: { value: string }): Promise<any>;
  getCurrentDrawStatus(): Promise<{
    drawId: string;
    totalPrizePool: string;
    totalTickets: string;
    timeLeft: string;
    isActive: boolean;
  }>;
  getDrawInfo(drawId: number): Promise<{
    totalPrizePool: string;
    totalTickets: string;
    winningMainNumbers: number[];
    winningLuckyStars: number[];
    isCompleted: boolean;
    drawStartTime: string;
    drawEndTime: string;
  }>;
  getPlayerTickets(
    drawId: number,
    player: string
  ): Promise<
    {
      mainNumbers: number[];
      luckyStars: number[];
      player: string;
      timestamp: string;
    }[]
  >;
  requestDrawRandomness(): Promise<any>;
  pause(): Promise<any>;
  unpause(): Promise<any>;
}

export interface VRFCoordinatorMock {
  address: string;
  createSubscription(): Promise<any>;
  fundSubscription(subId: string, amount: string): Promise<any>;
  addConsumer(subId: string, consumer: string): Promise<any>;
  fulfillRandomWords(requestId: number, consumer: string): Promise<any>;
}
