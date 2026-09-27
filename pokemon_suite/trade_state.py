"""Terminal native trade states shared by inventory and owner lifecycle."""


def native_trade_finished(trade):
    if not trade or trade.get('phase') == 'complete':
        return True
    if trade.get('phase') == 'interrupted':
        completion=trade.get('completion') or {}
        return (completion.get('nativeSaveVerified') is True
                and completion.get('saveHandshakeVerified') is True
                and (trade.get('recovery') or {}).get('fieldVerified') is True)
    return (trade.get('phase') == 'cancelled'
            and (trade.get('cancellation') or {}).get('exitVerified') is True
            and not trade.get('exchangeStarted'))
