// cur_ack_id keeps track of what sequences we've seen, and we'll use
// that information both locally to weed out potential duplicate
// information and pass it back to the server so it can clear out its
// own output buffers

var cur_ack_id = -1;


// in and out-bound 'packets' of information we don't process the
// information in-line, but instead let another area of code pick up
// data from the 'inbox' array

var packets = {
    inbox : new Array();
    outbox : new Array();
};

// this captures the number of consecutive errors we got.  The
// value is reset to 0 whenever we get information through
var long_poll_contErrorCount = 0;


// health is an indication of the quality of the communication.  It's
// value goes from 0.0 (bad), to 1.0 (excellent).  A low health score
// may mean bad network connectivity, or issues on your server (like
// maybe it's overloaded, etc.).  You can use the health indicator to
// visually tell the user what's going on.

// In the code that calls adjustHealth you'll notice that we weight
// errors 3 times more than good outcomes.  I arrived at this
// empirically.  The justification is that we expect communication to
// be good (+0.1), but we get kind of angry when it doesn't (-0.3).

var health = 1.0;

var adjustHealth = (function adjustHealth(delta) {

    if (delta < 0) {
        health = Math.max(health + delta, 0.0);
    } else {
        health = Math.min(health + delta, 1.0);
    }
    
});

var longPoll = (function longPoll() {

    var obj = {
        ms_duration : 10 * 1000, // max long poll is 10 seconds
        ack_id : cur_ack_id
    };

    var ajax_options = {
        type: "post",
        data: jQuery.toJSON(obj),
        cache: false,
        dataType: "json",
        timeout: obj.ms_duration
    };

    jQuery.ajax(ajax_options)

        .success(function(data) {

            if (!data) return;

            while (1) {

                var event = data.events.shift();
                if (event === undefined) break;
                
                if (cur_ack_id < event._info.id) {

                    // this is finally where we add the 'event' data
                    // to an array for later processing (in code
                    // elsewhere) we also update our cur_ack_id

                    cur_ack_id = event._info.id;
                    packets.inbox.push(event);

                } else {
                    
                    // we've already seen this data, so let's ignore
                    // it.  Because we'll send our cur_ack_id to the
                    // server, it should know not to re-send us this
                    // old data.  This condition should only happen
                    // very rarely.

                }
            }

        })

        .complete(function(jqXHR, textStatus) {

            // there may be cleaner ways of doing this, but this works
            // for us: we only consider 'non-success' results where
            // the status isn't 'notmodified' -- we shouldn't be
            // getting not-modified anyways because the server should
            // be sending a non-cachable header but we also want to
            // exclude 'timeouts' to count against an error

            if (textStatus != "success" && textStatus != "notmodified" && textStatus != "timeout") {
                adjustHealth(-0.3);
                long_poll_contErrorCount++;
            } else {
                adjustHealth(0.1);                        
                long_poll_contErrorCount = 0;
            }

            // two consecutive erros in a row? Let's give the network
            // gremlins some time to calm down.  100 ms for each
            // consecutive error.  You may want to clip this at like 2
            // seconds or something...

            if (long_poll_contErrorCount > 2) {
                var sleeper = 100 * long_poll_contErrorCount;
                setTimeout(longPoll, sleeper);
            } else {
                setTimeout(longPoll, 1);                        
            }
        });

    // let's continue to call ourselves, but let's avoid recursion:
    setTimeout(longPoll, 1);
    
}
