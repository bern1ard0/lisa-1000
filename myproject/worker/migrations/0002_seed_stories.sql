INSERT INTO works (id, owner_id, kind, title, genre, language, length, source, cover_image_url, created_at) VALUES
    ('w_001', 'lisa', 'story', 'Spot', 'friendship', 'en', 'very_short', 'lisa', 'images/covers/story_1.webp', 1752624000);
INSERT INTO work_emotions (work_id, emotion) VALUES ('w_001', 'happy');
INSERT INTO scenes (id, work_id, idx, display_text) VALUES
    ('sc_001_00', 'w_001', 0, 'Spot. Spot saw the shiny car and said, "Wow, Kitty, your car is so bright and clean!" Kitty smiled and replied, "Thank you, Spot. I polish it every day."');
INSERT INTO scenes (id, work_id, idx, display_text) VALUES
    ('sc_001_01', 'w_001', 1, 'After playing with the car, Kitty and Spot felt thirsty. They found a small pond with clear water. They drank the water and felt very happy. They played together all day and became best friends.');

INSERT INTO works (id, owner_id, kind, title, genre, language, length, source, cover_image_url, created_at) VALUES
    ('w_002', 'lisa', 'story', 'Roxy''s Icy Adventure', 'adventure', 'en', 'short', 'lisa', 'images/covers/story_2.webp', 1752624000);
INSERT INTO work_emotions (work_id, emotion) VALUES ('w_002', 'excited');
INSERT INTO work_emotions (work_id, emotion) VALUES ('w_002', 'cozy');
INSERT INTO scenes (id, work_id, idx, display_text) VALUES
    ('sc_002_00', 'w_002', 0, 'Once upon a time, in a big forest, there lived a rhinoceros named Roxy. Roxy loved to climb. She climbed trees, rocks, and hills. One day, Roxy found an icy hill. She had never seen anything like it before. It was shiny and cold, and she wanted to climb it.');
INSERT INTO scenes (id, work_id, idx, display_text) VALUES
    ('sc_002_01', 'w_002', 1, 'Roxy tried to climb the icy hill, but it was very slippery. She tried again and again, but she kept falling down. Roxy was sad. She wanted to climb the icy hill so much. Then, she saw a little bird named Billy. Billy saw that Roxy was sad and asked, "Why are you sad, Roxy?"');
INSERT INTO scenes (id, work_id, idx, display_text) VALUES
    ('sc_002_02', 'w_002', 2, 'Roxy told Billy about the icy hill and how she couldn''t climb it. Billy said, "I have an idea! Let''s find some big leaves to put under your feet. They will help you climb the icy hill." Roxy and Billy looked for big leaves and found some. Roxy put the leaves under her feet and tried to climb the icy hill again.');
INSERT INTO scenes (id, work_id, idx, display_text) VALUES
    ('sc_002_03', 'w_002', 3, 'This time, Roxy didn''t slip. She climbed and climbed until she reached the top of the icy hill. Roxy was so happy! She and Billy played on the icy hill all day. From that day on, Roxy and Billy were the best of friends, and they climbed and played together all the time. And Roxy learned that with a little help from a friend, she could climb anything.');

INSERT INTO works (id, owner_id, kind, title, genre, language, length, source, cover_image_url, created_at) VALUES
    ('w_003', 'lisa', 'story', 'Daisy and Max', 'friendship', 'en', 'very_short', 'lisa', 'images/covers/story_3.webp', 1752624000);
INSERT INTO work_emotions (work_id, emotion) VALUES ('w_003', 'happy');
INSERT INTO scenes (id, work_id, idx, display_text) VALUES
    ('sc_003_00', 'w_003', 0, 'Once upon a time, in a small yard, there was a small daisy. The daisy had a name. Her name was Daisy. Daisy was very small, but she was also very happy.');
INSERT INTO scenes (id, work_id, idx, display_text) VALUES
    ('sc_003_01', 'w_003', 1, 'One day, Daisy saw a dog. The dog was big and had a name too. His name was Max. Max liked to play in the yard. Daisy liked to watch Max play. Max and Daisy became friends.');
INSERT INTO scenes (id, work_id, idx, display_text) VALUES
    ('sc_003_02', 'w_003', 2, 'Every day, Max would come to the yard to play. Daisy would watch and smile. They were very happy together. And even though Daisy was small, she knew that she had a big friend in Max.');

INSERT INTO works (id, owner_id, kind, title, genre, language, length, source, cover_image_url, created_at) VALUES
    ('w_004', 'lisa', 'story', 'Sue''s Thoughtful Act', 'kindness', 'en', 'short', 'lisa', 'images/covers/story_4.webp', 1752624000);
INSERT INTO work_emotions (work_id, emotion) VALUES ('w_004', 'inspired');
INSERT INTO scenes (id, work_id, idx, display_text) VALUES
    ('sc_004_00', 'w_004', 0, 'Once upon a time, there was a thoughtful girl named Sue. Sue loved to help her mom around the house. One day, her mom asked her to wipe the table after they ate their lunch. Sue was happy to help.');
INSERT INTO scenes (id, work_id, idx, display_text) VALUES
    ('sc_004_01', 'w_004', 1, 'As Sue was wiping the table, she saw a pretty candle on the window sill. The candle was her mom''s favorite. Sue wanted to do something nice for her mom, so she said, "Mom, can I light the candle for you?" Her mom said, "Yes, but be very careful."');
INSERT INTO scenes (id, work_id, idx, display_text) VALUES
    ('sc_004_02', 'w_004', 2, 'Sue carefully lit the candle and put it on the table. Her mom was so happy to see the pretty candle. They both sat and watched the candle burn. Sue''s mom said, "Thank you, Sue, for being so thoughtful and careful." Sue felt proud that she could help her mom.');
INSERT INTO scenes (id, work_id, idx, display_text) VALUES
    ('sc_004_03', 'w_004', 3, 'The moral of the story is to always be thoughtful and careful when helping others.');

INSERT INTO works (id, owner_id, kind, title, genre, language, length, source, cover_image_url, created_at) VALUES
    ('w_005', 'lisa', 'story', 'The Kind Farmer', 'kindness', 'en', 'very_short', 'lisa', 'images/covers/story_5.webp', 1752624000);
INSERT INTO work_emotions (work_id, emotion) VALUES ('w_005', 'inspired');
INSERT INTO work_emotions (work_id, emotion) VALUES ('w_005', 'happy');
INSERT INTO scenes (id, work_id, idx, display_text) VALUES
    ('sc_005_00', 'w_005', 0, 'Once upon a time, there was a kind farmer. He had a big cow. The cow was sad. The farmer did not know why.');
INSERT INTO scenes (id, work_id, idx, display_text) VALUES
    ('sc_005_01', 'w_005', 1, 'One day, a little boy came to the farm. He saw the sad cow. The boy kneeled down to talk to the cow. "Why are you sad, cow?" he asked. The cow said, "I am lonely. I want a friend."');
INSERT INTO scenes (id, work_id, idx, display_text) VALUES
    ('sc_005_02', 'w_005', 2, 'The kind farmer heard the cow. He wanted to help. So, he got another cow to be friends with the sad cow. The sad cow was happy now. They played together every day. And the kind farmer, the little boy, and the two cows all lived happily ever after.');

INSERT INTO works (id, owner_id, kind, title, genre, language, length, source, cover_image_url, created_at) VALUES
    ('w_006', 'lisa', 'story', 'Lucy and Tom''s Park Adventure', 'adventure', 'en', 'short', 'lisa', 'images/covers/story_6.webp', 1752624000);
INSERT INTO work_emotions (work_id, emotion) VALUES ('w_006', 'happy');
INSERT INTO scenes (id, work_id, idx, display_text) VALUES
    ('sc_006_00', 'w_006', 0, 'Once upon a time, there was a little girl named Lucy. She had a pet cat named Tom. They loved to play together in the big green park near their house. One sunny day, they went to the park to play.');
INSERT INTO scenes (id, work_id, idx, display_text) VALUES
    ('sc_006_01', 'w_006', 1, 'While playing, Tom saw a big sour lemon on the ground. He wanted to play with it, but when he touched it, it started to roll away. Tom ran after the lemon, trying to catch it. But as he ran, Tom got lost in the park. Lucy looked around, but she could not find Tom. She was very sad.');
INSERT INTO scenes (id, work_id, idx, display_text) VALUES
    ('sc_006_02', 'w_006', 2, 'Lucy did not give up. She searched the park for her friend. At last, she found him near a big tree. Tom was trying to catch the lemon, but it vanished into a hole in the ground. Tom was happy to see Lucy again. They hugged and went back home together. They had a fun escape in the park, but they decided to leave the sour lemon behind.');

INSERT INTO works (id, owner_id, kind, title, genre, language, length, source, cover_image_url, created_at) VALUES
    ('w_007', 'lisa', 'story', 'Spot and Buddy''s Goal', 'friendship', 'en', 'very_short', 'lisa', 'images/covers/story_7.webp', 1752624000);
INSERT INTO work_emotions (work_id, emotion) VALUES ('w_007', 'happy');
INSERT INTO work_emotions (work_id, emotion) VALUES ('w_007', 'funny');
INSERT INTO scenes (id, work_id, idx, display_text) VALUES
    ('sc_007_00', 'w_007', 0, 'Once upon a time, there was a little brown dog named Spot. He loved to play with his ball in the park. One sunny day, Spot saw a big goal on the other side of the park. He wanted to get his ball into the goal.');
INSERT INTO scenes (id, work_id, idx, display_text) VALUES
    ('sc_007_01', 'w_007', 1, 'Spot ran fast with the ball in his mouth. He tried to kick the ball into the goal, but he was too small. Spot started to struggle. He tried again and again, but the ball would not go in.');
INSERT INTO scenes (id, work_id, idx, display_text) VALUES
    ('sc_007_02', 'w_007', 2, 'Then, Spot had an idea. He asked his friend, a big brown horse named Buddy, for help. Buddy kicked the ball with his strong legs. The ball flew into the goal! Spot was so happy. He and Buddy played together all day long.');

INSERT INTO works (id, owner_id, kind, title, genre, language, length, source, cover_image_url, created_at) VALUES
    ('w_008', 'lisa', 'story', 'Tom''s Lost Ball', 'mystery', 'en', 'very_short', 'lisa', 'images/covers/story_8.webp', 1752624000);
INSERT INTO work_emotions (work_id, emotion) VALUES ('w_008', 'happy');
INSERT INTO scenes (id, work_id, idx, display_text) VALUES
    ('sc_008_00', 'w_008', 0, 'Once upon a time, there was a little boy named Tom. He loved to play with his red ball. One sunny day, Tom went outside to play with his ball in the land near his home.');
INSERT INTO scenes (id, work_id, idx, display_text) VALUES
    ('sc_008_01', 'w_008', 1, 'Tom kicked the ball high in the sky. The ball went far, far away. Tom was sad because he could not find his ball. He walked and walked, looking for it. The land was big and sometimes dangerous. Tom knew he had to be careful.');
INSERT INTO scenes (id, work_id, idx, display_text) VALUES
    ('sc_008_02', 'w_008', 2, 'At last, Tom found his ball near a big tree. He was very happy. Tom knew he should not kick the ball too hard next time. He went back home, holding his ball tightly. Tom played safely in his yard, away from the dangerous land.');

INSERT INTO works (id, owner_id, kind, title, genre, language, length, source, cover_image_url, created_at) VALUES
    ('w_009', 'lisa', 'story', 'Max and the Cat', 'friendship', 'en', 'very_short', 'lisa', 'images/covers/story_9.webp', 1752624000);
INSERT INTO work_emotions (work_id, emotion) VALUES ('w_009', 'happy');
INSERT INTO scenes (id, work_id, idx, display_text) VALUES
    ('sc_009_00', 'w_009', 0, 'Once upon a time, there was a big dog named Max. Max had a red collar that he wore every day. He loved to play and run in the park with his friends.');
INSERT INTO scenes (id, work_id, idx, display_text) VALUES
    ('sc_009_01', 'w_009', 1, 'One day, Max saw a cat on a tree. He wanted to be friends with the cat. So, Max tried to stretch up to reach the cat. But he was not tall enough. He tried again and again, but he just couldn''t reach the cat.');
INSERT INTO scenes (id, work_id, idx, display_text) VALUES
    ('sc_009_02', 'w_009', 2, 'Max felt sad, but then he had an idea. He found a big box and put it under the tree. Max climbed on the box and stretched one more time. This time, he reached the cat! The cat and Max became good friends, and they played together every day.');

INSERT INTO works (id, owner_id, kind, title, genre, language, length, source, cover_image_url, created_at) VALUES
    ('w_010', 'lisa', 'story', 'Mia and Tom''s Jewelry Adventure', 'adventure', 'en', 'short', 'lisa', 'images/covers/story_10.webp', 1752624000);
INSERT INTO work_emotions (work_id, emotion) VALUES ('w_010', 'happy');
INSERT INTO scenes (id, work_id, idx, display_text) VALUES
    ('sc_010_00', 'w_010', 0, 'Once upon a time, there was a girl named Mia. Mia loved her jewelry. She had a big box full of pretty things. She liked to wear them all day. But at night, she had to sleep.');
INSERT INTO scenes (id, work_id, idx, display_text) VALUES
    ('sc_010_01', 'w_010', 1, 'One day, Mia met a talking cat named Tom. Tom was a tough cat, but he was nice. Tom said, "Hi, Mia! I like your jewelry. Can I wear some too?" Mia said, "Yes, Tom. You can wear my jewelry, but we have to give it back before we sleep."');
INSERT INTO scenes (id, work_id, idx, display_text) VALUES
    ('sc_010_02', 'w_010', 2, 'So, Mia and Tom played together. They wore the jewelry and had fun. They pretended to be kings and queens. They laughed and danced. But soon, the sun went down, and it was time for bed.');
INSERT INTO scenes (id, work_id, idx, display_text) VALUES
    ('sc_010_03', 'w_010', 3, 'Mia said, "Tom, we must give back the jewelry now. It''s time to sleep." Tom gave back the jewelry and said, "Thank you, Mia. I had fun today." They put the jewelry back in the box and went to sleep. Mia and Tom were happy, and they had sweet dreams.');
