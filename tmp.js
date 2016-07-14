_.each(listtags, function(item, i) {

    if(i==0) { //DEBUG

        var listtag = $(item);


        var playlist = {
            url: listtag.attr("href"),
            title: listtag.html()
        };

        request(baseuri + playlist.url, function (error, response, body) {

            if (!error && response.statusCode == 200) {

                var $ = cheerio.load(body);

                var vtags = $(".pl-video-title a");

                _.each(vtags, function (item, i) {

                    if(i==0) { //DEBUG

                        var vtag = $(item);

                        var v = {
                            id: vtag.attr("href").match(/watch\?v=([^&]+)/)[1],
                            title: vtag.html().replace(/^[\s]*/, "").replace(/[\s]*$/g, "")
                        };



                        console.log(v);

                    } //DEBUG

                });

            }

        });

    } //DEBUG

});